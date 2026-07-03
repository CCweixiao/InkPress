import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { ensureUserInvitationCode } from "@/lib/invite-code";
import { DashboardClient } from "@/components/dashboard/dashboard-client";

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login?callbackUrl=/dashboard");
  }

  // 安全网：补发邀请码（OAuth/早期用户）
  await ensureUserInvitationCode(session.user.id);

  const [user, invite, attributedLicenses] = await Promise.all([
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

  return <DashboardClient user={user} invite={invite} attributedLicenses={licenses} />;
}

