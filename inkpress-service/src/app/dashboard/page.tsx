import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { ensureUserInvitationCode } from "@/lib/invite-code";
import {
  computeLicenseLifecycle,
  durationLabel,
} from "@/lib/license/key";
import { DashboardClient } from "@/components/dashboard/dashboard-client";

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login?callbackUrl=/dashboard");
  }

  // 安全网：补发邀请码（OAuth/早期用户）
  await ensureUserInvitationCode(session.user.id);

  // 用户邮箱已规范化存储；为兼容历史/OAuth 用户再保险一次。
  const ownerEmail = session.user.email?.trim().toLowerCase();

  const [user, invite, attributedLicenses, ownedLicenses] = await Promise.all([
    prisma.user.findUnique({
      where: { id: session.user.id },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        status: true,
        mustChangePassword: true,
        createdAt: true,
      },
    }),
    prisma.invitationCode.findUnique({
      where: { userId: session.user.id },
      select: { code: true, status: true },
    }),
    prisma.licenseKey.findMany({
      where: { inviterUserId: session.user.id },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: {
        id: true,
        keyFingerprint: true,
        displayKeySuffix: true,
        durationKind: true,
        status: true,
        maxDevices: true,
        firstActivatedAt: true,
        effectiveExpiresAt: true,
        createdAt: true,
        _count: { select: { activations: { where: { status: "ACTIVE" } } } },
      },
    }),
    ownerEmail
      ? prisma.licenseKey.findMany({
          where: { ownerEmail },
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            keyFingerprint: true,
            displayKeySuffix: true,
            durationKind: true,
            durationYears: true,
            durationDays: true,
            effectiveExpiresAt: true,
            maxDevices: true,
            status: true,
            firstActivatedAt: true,
            createdAt: true,
            note: true,
            activations: {
              orderBy: { activatedAt: "desc" },
              select: {
                id: true,
                deviceIdHash: true,
                os: true,
                arch: true,
                appVersion: true,
                status: true,
                activatedAt: true,
                lastValidatedAt: true,
                deactivatedAt: true,
              },
            },
          },
        })
      : [],
  ]);

  if (!user) redirect("/login");

  const licenses = attributedLicenses.map((l) => ({
    id: l.id,
    keyFingerprint: l.keyFingerprint,
    displayKeySuffix: l.displayKeySuffix,
    durationKind: l.durationKind,
    status: l.status,
    maxDevices: l.maxDevices,
    activeDevices: l._count.activations,
    firstActivatedAt: l.firstActivatedAt,
    effectiveExpiresAt: l.effectiveExpiresAt,
    createdAt: l.createdAt,
  }));

  const now = new Date();
  const owned = ownedLicenses.map((l) => ({
    id: l.id,
    keyFingerprint: l.keyFingerprint,
    displayKeySuffix: l.displayKeySuffix,
    durationKind: l.durationKind,
    durationLabel: durationLabel(l.durationKind, l.durationYears, l.durationDays),
    maxDevices: l.maxDevices,
    activeDevices: l.activations.filter((a) => a.status === "ACTIVE").length,
    status: l.status,
    lifecycle: computeLicenseLifecycle(
      l.firstActivatedAt,
      l.effectiveExpiresAt,
      now
    ),
    firstActivatedAt: l.firstActivatedAt,
    effectiveExpiresAt: l.effectiveExpiresAt,
    createdAt: l.createdAt,
    note: l.note,
    activations: l.activations.map((a) => ({
      id: a.id,
      deviceIdShort: a.deviceIdHash.slice(0, 12),
      os: a.os,
      arch: a.arch,
      appVersion: a.appVersion,
      status: a.status,
      activatedAt: a.activatedAt,
      lastValidatedAt: a.lastValidatedAt,
      deactivatedAt: a.deactivatedAt,
    })),
  }));

  return (
    <DashboardClient
      user={user}
      invite={invite}
      attributedLicenses={licenses}
      ownedLicenses={owned}
    />
  );
}

