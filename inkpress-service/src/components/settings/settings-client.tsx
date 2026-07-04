"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ServiceHeader } from "@/components/navigation/service-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate } from "@/lib/utils";

export interface SettingsUser {
  id: string;
  email: string;
  name: string | null;
  role: string;
  status: string;
  mustChangePassword: boolean;
  emailVerified: Date | null;
  createdAt: Date;
}

export function SettingsClient({ user }: { user: SettingsUser }) {
  const router = useRouter();

  return (
    <div className="min-h-screen">
      <ServiceHeader isLoggedIn email={user.email} role={user.role} />

      <main className="mx-auto max-w-4xl space-y-6 px-6 py-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">个人设置</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              管理账号资料与密码安全。
            </p>
          </div>
          <Badge variant={user.role === "ADMIN" ? "default" : "secondary"}>
            {user.role === "ADMIN" ? "管理员" : "用户"}
          </Badge>
        </div>

        {user.mustChangePassword && (
          <div className="rounded-md border border-amber-500/40 bg-amber-50 px-4 py-3 text-sm text-amber-700 dark:bg-amber-950/30 dark:text-amber-300">
            当前使用初始密码，建议尽快修改。
          </div>
        )}

        <Card>
          <CardHeader>
            <CardTitle>账户信息</CardTitle>
            <CardDescription>你的基本账号资料</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-4 text-sm">
            <Field label="邮箱" value={user.email} />
            <Field label="昵称" value={user.name ?? "—"} />
            <Field label="角色" value={user.role === "ADMIN" ? "管理员" : "普通用户"} />
            <Field label="状态" value={user.status} />
            <Field
              label="邮箱验证"
              value={user.emailVerified ? formatDate(user.emailVerified) : "未验证"}
            />
            <Field label="注册时间" value={formatDate(user.createdAt)} />
          </CardContent>
        </Card>

        <ChangePasswordCard
          onDone={() => router.refresh()}
        />
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

function ChangePasswordCard({ onDone }: { onDone: () => void }) {
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(false);
    if (newPassword !== confirmPassword) {
      setError("两次输入的新密码不一致");
      return;
    }
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
    setSuccess(true);
    setOldPassword("");
    setNewPassword("");
    setConfirmPassword("");
    onDone();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>修改密码</CardTitle>
        <CardDescription>需要验证原密码后设置新密码</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="grid max-w-md gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="old">原密码</Label>
            <Input
              id="old"
              type="password"
              autoComplete="current-password"
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
              autoComplete="new-password"
              required
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">至少 8 位，需含字母与数字</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="confirm">确认新密码</Label>
            <Input
              id="confirm"
              type="password"
              autoComplete="new-password"
              required
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
            />
          </div>
          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
          {success && (
            <p className="text-sm text-emerald-600" role="status">
              密码已修改
            </p>
          )}
          <div>
            <Button type="submit" disabled={loading}>
              {loading ? "提交中…" : "修改密码"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
