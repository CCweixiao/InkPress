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
import { LicenseStatusBadge } from "@/components/admin/status-badge";
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

export function DashboardClient({
  user,
  invite,
  attributedLicenses,
}: {
  user: DashboardUser;
  invite: DashboardInvite | null;
  attributedLicenses: AttributedLicense[];
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
