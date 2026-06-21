import Link from "next/link";
import { ArrowLeft, Settings, Sparkles, ScrollText } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { SystemConfigManager } from "@/components/settings/SystemConfigManager";
import { LogsViewer } from "@/components/settings/LogsViewer";

export const dynamic = "force-dynamic";

export default function SettingsPage() {
  return (
    <div className="min-h-screen">
      <header className="border-b border-border bg-background/80 backdrop-blur sticky top-0 z-40">
        <div className="mx-auto max-w-4xl px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4" />
              返回
            </Link>
            <span className="text-muted-foreground/40">/</span>
            <div className="flex items-center gap-2">
              <Settings className="h-5 w-5 text-primary" />
              <span className="font-semibold">设置</span>
            </div>
          </div>
          <Button asChild variant="ghost" size="sm">
            <Link href="/">工作台</Link>
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-6 py-8 space-y-6">
        {/* 统一配置：AI 模型 / 写作 Agent / OSS / 微信公众号 */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" />
              <CardTitle>系统配置</CardTitle>
            </div>
            <CardDescription>
              在此可视化配置 AI 模型供应商、写作 Agent、OSS 对象存储与微信公众号凭证。
              所有配置存储于本地数据库（仅本机可读），AI / 发布接口将自动加载，无需编辑环境变量。
            </CardDescription>
          </CardHeader>
          <CardContent>
            <SystemConfigManager />
          </CardContent>
        </Card>

        {/* 系统日志 */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <ScrollText className="h-5 w-5 text-primary" />
              <CardTitle>系统日志</CardTitle>
            </div>
            <CardDescription>
              实时查看系统运行日志，支持按级别筛选、关键词搜索与实时刷新。
            </CardDescription>
          </CardHeader>
          <CardContent>
            <LogsViewer />
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
