"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const GITHUB_ENABLED = process.env.NEXT_PUBLIC_GITHUB_ENABLED === "1";

/** NextAuth OAuth 错误码 → 友好提示（redirect 回 /login?error=xxx 时读取） */
const OAUTH_ERROR_MESSAGES: Record<string, string> = {
  OAuthSignin: "无法连接 GitHub 授权服务，请稍后重试",
  OAuthCallback: "GitHub 授权回调失败，请重试",
  OAuthCreateAccount: "GitHub 账号关联失败，请联系管理员",
  EmailCreateAccount: "账号创建失败，请联系管理员",
  Callback: "登录回调异常，请重试",
  AccessDenied: "已取消 GitHub 授权",
  Configuration: "登录服务配置异常，请联系管理员",
  Verification: "登录验证失败，请重试",
};

function GitHubIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
    </svg>
  );
}

export default function LoginPage() {
  // useSearchParams 必须在 <Suspense> 内，否则 next build 报错
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const callbackUrl = params.get("callbackUrl") ?? "/dashboard";
  const oauthError = params.get("error");
  const resetDone = params.get("reset") === "1";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(
    oauthError
      ? OAUTH_ERROR_MESSAGES[oauthError] ?? "GitHub 登录失败，请重试"
      : null
  );
  const [loading, setLoading] = useState(false);
  const [githubLoading, setGithubLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const res = await signIn("credentials", {
      email,
      password,
      redirect: false,
    });
    setLoading(false);
    if (!res || res.error) {
      setError("邮箱或密码错误");
      return;
    }
    router.push(callbackUrl);
    router.refresh();
  }

  /**
   * GitHub OAuth 登录：signIn 默认 redirect=true，浏览器直接跳转到 GitHub 授权页。
   * 授权完成后回调 /api/auth/callback/github → 成功跳 callbackUrl，失败回 /login?error=xxx。
   * loading 状态仅在跳转发起期间提供视觉反馈（页面导航后组件即卸载）。
   */
  async function onGitHubLogin() {
    setError(null);
    setGithubLoading(true);
    // redirect 默认 true：浏览器导航到 GitHub，不会 resolve 回来
    signIn("github", { callbackUrl });
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>登录 InkPress</CardTitle>
          <CardDescription>使用邮箱密码或 GitHub 账号登录</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form onSubmit={onSubmit} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="email">邮箱</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">密码</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <div className="flex justify-end">
              <Link
                href="/forgot-password"
                className="text-xs text-muted-foreground hover:text-primary hover:underline"
              >
                忘记密码？
              </Link>
            </div>
            {resetDone && !error && (
              <p className="text-sm text-emerald-600" role="status">
                密码已重置，请使用新密码登录
              </p>
            )}
            {error && (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            )}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "登录中…" : "登录"}
            </Button>
          </form>

          {GITHUB_ENABLED && (
            <>
              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-card px-2 text-muted-foreground">或</span>
                </div>
              </div>
              <Button
                variant="outline"
                className="w-full gap-2"
                onClick={onGitHubLogin}
                disabled={githubLoading}
              >
                <GitHubIcon className="h-5 w-5" />
                {githubLoading ? "跳转中…" : "使用 GitHub 登录"}
              </Button>
            </>
          )}

          <p className="text-center text-sm text-muted-foreground">
            还没有账号？{" "}
            <Link href="/register" className="text-primary hover:underline">
              注册
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
