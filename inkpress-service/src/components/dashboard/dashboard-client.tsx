"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signOut } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  LicenseStatusBadge,
  LicenseLifecycleBadge,
  ActivationStatusBadge,
} from "@/components/admin/status-badge";
import { durationLabel } from "@/lib/license/key";
import { formatDate } from "@/lib/utils";

export interface DashboardUser {
  id: string;
  email: string;
  name: string | null;
  role: string;
  status: string;
  mustChangePassword: boolean;
  createdAt: Date;
}

export interface DashboardInvite {
  code: string;
  status: string;
}

export interface AttributedLicense {
  id: string;
  keyFingerprint: string;
  displayKeySuffix: string;
  durationKind: string;
  status: string;
  maxDevices: number;
  activeDevices: number;
  firstActivatedAt: Date | null;
  effectiveExpiresAt: Date | null;
  createdAt: Date;
}

export interface OwnedLicenseActivation {
  id: string;
  deviceIdShort: string;
  os: string | null;
  arch: string | null;
  appVersion: string | null;
  status: string;
  activatedAt: Date;
  lastValidatedAt: Date | null;
  deactivatedAt: Date | null;
}

export interface OwnedLicense {
  id: string;
  keyFingerprint: string;
  displayKeySuffix: string;
  durationKind: string;
  durationLabel: string;
  maxDevices: number;
  activeDevices: number;
  status: string;
  lifecycle: string;
  firstActivatedAt: Date | null;
  effectiveExpiresAt: Date | null;
  createdAt: Date;
  note: string | null;
  activations: OwnedLicenseActivation[];
}

export function DashboardClient({
  user,
  invite,
  attributedLicenses,
  ownedLicenses,
}: {
  user: DashboardUser;
  invite: DashboardInvite | null;
  attributedLicenses: AttributedLicense[];
  ownedLicenses: OwnedLicense[];
}) {
  const router = useRouter();
  const [changed, setChanged] = useState(!user.mustChangePassword);

  return (
    <div className="min-h-screen">
      <header className="border-b">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-3">
          <div className="flex items-center gap-3">
            <span className="text-base font-semibold">InkPress</span>
            <Badge variant={user.role === "ADMIN" ? "default" : "secondary"}>
              {user.role === "ADMIN" ? "管理员" : "用户"}
            </Badge>
          </div>
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <span>{user.email}</span>
            <Link href="/dashboard/orders" className="text-primary hover:underline">
              我的订单
            </Link>
            <Link href="/settings" className="text-primary hover:underline">
              个人信息
            </Link>
            {user.role === "ADMIN" && (
              <Link href="/admin" className="text-primary hover:underline">
                管理后台
              </Link>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => signOut({ callbackUrl: "/login" })}
            >
              退出
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl space-y-6 px-6 py-8">
        {!changed && (
          <ChangePasswordCard
            onDone={() => {
              setChanged(true);
              router.refresh();
            }}
          />
        )}

        <Card>
          <CardHeader>
            <CardTitle>账户信息</CardTitle>
            <CardDescription>你的基本信息</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-4 text-sm">
            <Field label="邮箱" value={user.email} />
            <Field label="昵称" value={user.name ?? "—"} />
            <Field label="角色" value={user.role === "ADMIN" ? "管理员" : "普通用户"} />
            <Field label="状态" value={user.status} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>我的邀请码</CardTitle>
            <CardDescription>
              6 位大小写敏感，管理员生成 License 时可绑定以归因
            </CardDescription>
          </CardHeader>
          <CardContent>
            {invite ? (
              <InviteCodeRow code={invite.code} status={invite.status} />
            ) : (
              <p className="text-sm text-muted-foreground">未生成</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>我的 License</CardTitle>
            <CardDescription>
              绑定到当前邮箱（{user.email}）的 License Key 与激活信息
            </CardDescription>
          </CardHeader>
          <CardContent>
            {ownedLicenses.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                暂无归属到你邮箱的 License。请联系管理员获取。
              </p>
            ) : (
              <OwnedLicensesList licenses={ownedLicenses} />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>归因 License 概况</CardTitle>
            <CardDescription>绑定你邀请码的 License（最近 10 条）</CardDescription>
          </CardHeader>
          <CardContent>
            {attributedLicenses.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                暂无归因到你的 License。
              </p>
            ) : (
              <div className="space-y-2">
                {attributedLicenses.map((l) => (
                  <div
                    key={l.id}
                    className="flex items-center justify-between rounded-md border px-3 py-2 text-sm"
                  >
                    <div className="flex items-center gap-3">
                      <code className="font-mono text-xs">{l.keyFingerprint}</code>
                      <LicenseStatusBadge status={l.status} />
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {durationLabel(l.durationKind)} · 设备 {l.activeDevices}/{l.maxDevices} ·{" "}
                      {l.effectiveExpiresAt
                        ? `到期 ${formatDate(l.effectiveExpiresAt)}`
                        : l.firstActivatedAt
                          ? "已激活"
                          : "未激活"}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-0.5 font-medium">{value}</div>
    </div>
  );
}

function InviteCodeRow({ code, status }: { code: string; status: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-3">
      <code className="rounded-md bg-muted px-3 py-1.5 font-mono text-lg tracking-widest">
        {code}
      </code>
      <Badge variant={status === "ACTIVE" ? "success" : "warning"}>
        {status === "ACTIVE" ? "可用" : "已停用"}
      </Badge>
      <Button
        variant="outline"
        size="sm"
        onClick={async () => {
          await navigator.clipboard.writeText(code);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? "已复制" : "复制"}
      </Button>
    </div>
  );
}

function OwnedLicensesList({ licenses }: { licenses: OwnedLicense[] }) {
  const [openId, setOpenId] = useState<string | null>(null);
  return (
    <div className="space-y-2">
      {licenses.map((l) => (
        <OwnedLicenseRow
          key={l.id}
          license={l}
          open={openId === l.id}
          onToggle={() => setOpenId((cur) => (cur === l.id ? null : l.id))}
        />
      ))}
    </div>
  );
}

function OwnedLicenseRow({
  license,
  open,
  onToggle,
}: {
  license: OwnedLicense;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="rounded-md border">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-muted/30"
        aria-expanded={open}
      >
        <div className="flex items-center gap-3">
          <code className="font-mono text-xs">{license.keyFingerprint}</code>
          <LicenseStatusBadge status={license.status} />
          <LicenseLifecycleBadge lifecycle={license.lifecycle} />
        </div>
        <div className="text-xs text-muted-foreground">
          {license.durationLabel} · 设备 {license.activeDevices}/{license.maxDevices} ·{" "}
          {license.effectiveExpiresAt
            ? `到期 ${formatDate(license.effectiveExpiresAt)}`
            : license.firstActivatedAt
              ? "已激活"
              : "未激活"}
        </div>
      </button>
      {open && (
        <div className="space-y-3 border-t bg-muted/20 px-3 py-3 text-xs">
          <RevealKeySection licenseId={license.id} />
          <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
            <DetailField label="后缀" value={<code className="font-mono">…{license.displayKeySuffix}</code>} />
            <DetailField label="有效期" value={license.durationLabel} />
            <DetailField label="设备上限" value={String(license.maxDevices)} />
            <DetailField label="首次激活" value={license.firstActivatedAt ? formatDate(license.firstActivatedAt) : "—"} />
            <DetailField label="实际到期" value={
              license.effectiveExpiresAt
                ? formatDate(license.effectiveExpiresAt)
                : license.durationKind === "PERMANENT"
                  ? "永久"
                  : "未激活（首激活后计算）"
            } />
            <DetailField label="创建时间" value={formatDate(license.createdAt)} />
          </div>
          {license.note && (
            <div>
              <span className="text-muted-foreground">备注：</span>
              {license.note}
            </div>
          )}
          <div>
            <div className="mb-1 text-muted-foreground">
              激活设备（{license.activations.length}）
            </div>
            {license.activations.length === 0 ? (
              <div className="text-muted-foreground">暂无激活设备</div>
            ) : (
              <div className="overflow-hidden rounded-md border bg-background">
                <table className="w-full text-xs">
                  <thead className="bg-muted/40 text-left uppercase text-muted-foreground">
                    <tr>
                      <th className="px-2 py-1.5">设备</th>
                      <th className="px-2 py-1.5">环境</th>
                      <th className="px-2 py-1.5">状态</th>
                      <th className="px-2 py-1.5">激活时间</th>
                      <th className="px-2 py-1.5">最近校验</th>
                    </tr>
                  </thead>
                  <tbody>
                    {license.activations.map((a) => (
                      <tr key={a.id} className="border-t">
                        <td className="px-2 py-1.5 font-mono">{a.deviceIdShort}</td>
                        <td className="px-2 py-1.5">
                          {a.os ?? "—"}/{a.arch ?? "—"} · {a.appVersion ?? "—"}
                        </td>
                        <td className="px-2 py-1.5">
                          <ActivationStatusBadge status={a.status} />
                        </td>
                        <td className="px-2 py-1.5">{formatDate(a.activatedAt)}</td>
                        <td className="px-2 py-1.5">
                          {a.lastValidatedAt ? formatDate(a.lastValidatedAt) : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * 查看 License Key 徽章 + 展示区。
 *
 * 交互：
 * - 未查看：显示「查看 Key」徽章按钮
 * - 加载中：徽章禁用并显示「加载中…」
 * - 已查看：展示明文 code + 复制 + 隐藏 按钮；明文缓存避免重复请求
 * - 错误：显示错误提示，徽章变「重试」
 *
 * 安全：明文通过 POST /api/me/owned-licenses/:id/reveal-key 获取（后端校验
 * ownerEmail === 当前登录邮箱），本组件只负责展示。
 */
function RevealKeySection({ licenseId }: { licenseId: string }) {
  const [plaintext, setPlaintext] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function reveal() {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(
        `/api/me/owned-licenses/${licenseId}/reveal-key`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        }
      );
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data?.error?.message ?? "查看失败");
        return;
      }
      setPlaintext(data.data.licenseKey as string);
      setRevealed(true);
    } catch {
      setError("网络错误");
    } finally {
      setLoading(false);
    }
  }

  function hide() {
    setRevealed(false);
  }

  if (revealed && plaintext) {
    return (
      <div className="space-y-1.5">
        <div className="text-muted-foreground">License Key（明文）</div>
        <div className="flex items-center gap-2">
          <code className="flex-1 break-all rounded-md border border-amber-500/40 bg-amber-50 px-2 py-1.5 font-mono text-sm dark:bg-amber-950/20">
            {plaintext}
          </code>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={async () => {
              if (!plaintext) return;
              try {
                await navigator.clipboard.writeText(plaintext);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              } catch {
                setError("复制失败，请手动选择");
              }
            }}
          >
            {copied ? "已复制" : "复制"}
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={hide}>
            隐藏
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={reveal}
        disabled={loading}
        className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary transition-colors hover:bg-primary/20 focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-60"
        aria-label="查看 License Key 明文"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-3 w-3"
          aria-hidden="true"
        >
          <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
        {loading ? "加载中…" : "查看 Key"}
      </button>
      {error && (
        <>
          <span className="text-destructive">{error}</span>
          <button
            type="button"
            onClick={reveal}
            disabled={loading}
            className="text-xs text-primary hover:underline"
          >
            重试
          </button>
        </>
      )}
    </div>
  );
}

function DetailField({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-muted-foreground">{label}</div>
      <div className="mt-0.5">{value}</div>
    </div>
  );
}

function ChangePasswordCard({ onDone }: { onDone: () => void }) {
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const res = await fetch("/api/me/password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ oldPassword, newPassword }),
    });
    setLoading(false);
    const data = await res.json();
    if (!res.ok || !data.ok) {
      setError(data?.error?.message ?? "修改失败");
      return;
    }
    onDone();
  }

  return (
    <Card className="border-amber-500/40">
      <CardHeader>
        <CardTitle className="text-amber-600">首次登录请修改密码</CardTitle>
        <CardDescription>当前使用初始密码，修改后即可正常使用</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="grid max-w-md gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="old">原密码</Label>
            <Input
              id="old"
              type="password"
              required
              value={oldPassword}
              onChange={(e) => setOldPassword(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new">新密码</Label>
            <Input
              id="new"
              type="password"
              required
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
          </div>
          {error && (
            <p className="text-sm text-destructive sm:col-span-2" role="alert">
              {error}
            </p>
          )}
          <div className="sm:col-span-2">
            <Button type="submit" disabled={loading}>
              {loading ? "提交中…" : "修改密码"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
