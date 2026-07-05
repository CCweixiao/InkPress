"use client";

import { useState, useSyncExternalStore } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  Apple,
  ChevronDown,
  Download,
  MonitorDown,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { ServiceHeader } from "@/components/navigation/service-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type DownloadsPlatform = {
  platform: string; // darwin-arm64 | darwin-x64 | win32-x64
  label: string;
  version: string;
  fileName: string;
  fileSizeBytes: number;
  downloadUrl: string;
  releasedAt: string;
};

export type DownloadsHistoryItem = Omit<DownloadsPlatform, "label"> & {
  platformLabel: string;
  changelogMarkdown: string | null;
};

export type DownloadsPageProps = {
  isLoggedIn: boolean;
  email?: string | null;
  role?: string | null;
  packageName: string;
  displayName: string;
  logoUrl: string | null;
  latestVersion: string;
  releasedAt: string | null;
  changelogMarkdown: string | null;
  highlights: string[];
  platforms: DownloadsPlatform[];
  history?: DownloadsHistoryItem[];
};

/**
 * 浏览器端识别当前设备平台，用于高亮推荐卡片。
 * - iPhone / iPad / Android → 推荐 darwin-arm64（移动端基本不能装，但还是给个推荐）
 * - Mac Intel → darwin-x64
 * - Mac M 系列 → darwin-arm64
 * - Windows → win32-x64
 */
function detectPlatform(): string | null {
  if (typeof navigator === "undefined") return null;
  const ua = navigator.userAgent;
  const platform = (navigator.platform || "") + " " + ua;
  if (/Win/i.test(platform)) return "win32-x64";
  if (/Macintosh|MacIntel/i.test(platform)) {
    // 苹果芯片判断：靠 GPU 信息或 UA 不可靠，让用户自己点；默认推荐 arm64
    // 简单启发：platform === "MacIntel" 在 Apple Silicon 上也是这个值
    return "darwin-arm64";
  }
  if (/iPhone|iPad|iPod/i.test(platform)) return "darwin-arm64";
  if (/Linux/i.test(platform)) return "linux-x64";
  return null;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("zh-CN", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}

/** useSyncExternalStore 的 noop subscribe：值只在 mount 时算一次，不订阅外部变化 */
const noopSubscribe = () => () => {};
const detectPlatformClient = (): string | null => detectPlatform();

/** 客户端首次渲染时识别平台；SSR 期间返回 null，避免 hydration mismatch */
function useCurrentPlatform(): string | null {
  return useSyncExternalStore(
    noopSubscribe,
    detectPlatformClient, // client snapshot（navigator 可用）
    () => null             // server snapshot
  );
}

function PlatformIcon({ platform, className }: { platform: string; className?: string }) {
  if (platform.startsWith("darwin")) return <Apple className={className} />;
  if (platform.startsWith("win")) return <MonitorDown className={className} />;
  return <MonitorDown className={className} />;
}

export function DownloadsPage(props: DownloadsPageProps) {
  const currentPlatform = useCurrentPlatform();
  const [showHistory, setShowHistory] = useState(false);

  const sortedPlatforms = [...props.platforms].sort((a, b) => {
    // 推荐平台排第一
    if (a.platform === currentPlatform) return -1;
    if (b.platform === currentPlatform) return 1;
    return 0;
  });

  return (
    <div className="min-h-screen bg-gradient-to-b from-background via-background to-muted/30">
      <ServiceHeader
        isLoggedIn={props.isLoggedIn}
        email={props.email}
        role={props.role}
      />

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div
          className="pointer-events-none absolute inset-0 -z-10 opacity-60"
          aria-hidden
          style={{
            background:
              "radial-gradient(60% 50% at 50% 0%, hsl(var(--primary) / 0.15), transparent 70%)",
          }}
        />
        <div className="mx-auto max-w-5xl px-4 pb-12 pt-16 text-center sm:px-6 sm:pt-24">
          <div className="mb-6 flex justify-center">
            <div className="relative h-24 w-24 overflow-hidden rounded-2xl border bg-background shadow-lg shadow-primary/10">
              {props.logoUrl ? (
                <Image
                  src={props.logoUrl}
                  alt={props.displayName}
                  fill
                  sizes="96px"
                  className="object-cover"
                  priority
                />
              ) : (
                <Image
                  src="/inkpress-logo.png"
                  alt={props.displayName}
                  fill
                  sizes="96px"
                  className="object-cover"
                  priority
                />
              )}
            </div>
          </div>

          <Badge variant="secondary" className="mb-3 gap-1.5">
            <Sparkles className="h-3 w-3" />
            v{props.latestVersion} · {props.releasedAt ? formatDate(props.releasedAt) : ""}
          </Badge>
          <h1 className="text-balance text-4xl font-bold tracking-tight sm:text-5xl">
            下载 {props.displayName}
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-balance text-base text-muted-foreground sm:text-lg">
            原生桌面体验，离线创作、一键发布。选择适合你设备的平台开始下载。
          </p>

          {/* 推荐下载按钮（当前平台） */}
          {currentPlatform && (
            <div className="mt-8 flex justify-center">
              <RecommendedDownload
                platform={
                  sortedPlatforms.find((p) => p.platform === currentPlatform) ?? null
                }
              />
            </div>
          )}
        </div>
      </section>

      {/* 平台卡片网格 */}
      <section className="mx-auto max-w-5xl px-4 pb-12 sm:px-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {sortedPlatforms.map((p) => {
            const recommended = p.platform === currentPlatform;
            return (
              <div
                key={p.platform}
                className={cn(
                  "group relative flex flex-col rounded-xl border bg-card p-6 transition-all hover:shadow-md",
                  recommended && "border-primary ring-2 ring-primary/20"
                )}
              >
                {recommended && (
                  <span className="absolute -top-2 left-6">
                    <Badge className="gap-1 shadow-sm">
                      <ShieldCheck className="h-3 w-3" />
                      推荐你的设备
                    </Badge>
                  </span>
                )}
                <div className="mb-4 flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted text-foreground">
                    <PlatformIcon platform={p.platform} className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="text-sm font-semibold">{p.label}</div>
                    <div className="text-xs text-muted-foreground">
                      v{p.version} · {formatSize(p.fileSizeBytes)}
                    </div>
                  </div>
                </div>
                <div className="mt-auto flex items-center justify-between gap-2">
                  <Button asChild size="sm" className="flex-1">
                    <a href={p.downloadUrl} download>
                      <Download className="mr-1.5 h-3.5 w-3.5" />
                      下载
                    </a>
                  </Button>
                  <span className="text-[10px] text-muted-foreground">
                    {formatDate(p.releasedAt)}
                  </span>
                </div>
              </div>
            );
          })}

          {/* 未上线平台占位 */}
          {["darwin-x64", "win32-x64", "linux-x64"]
            .filter(
              (plat) => !sortedPlatforms.some((p) => p.platform === plat)
            )
            .slice(0, 0)
            .map(() => null)}
        </div>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          所有安装包均通过阿里云 OSS 分发 · 文件完整性可由 SHA256 校验
        </p>
      </section>

      {/* Highlights */}
      {props.highlights.length > 0 && (
        <section className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
          <h2 className="mb-4 text-center text-lg font-semibold">
            本次更新亮点
          </h2>
          <ul className="grid gap-2 sm:grid-cols-2">
            {props.highlights.map((h, i) => (
              <li
                key={i}
                className="flex items-start gap-2 rounded-lg border bg-card p-3 text-sm"
              >
                <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                <span>{h}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Changelog & History */}
      {(props.changelogMarkdown || (props.history?.length ?? 0) > 0) && (
        <section className="mx-auto max-w-3xl px-4 pb-16 sm:px-6">
          <div className="rounded-xl border bg-card">
            <button
              type="button"
              onClick={() => setShowHistory((v) => !v)}
              className="flex w-full items-center justify-between p-4 text-left"
              aria-expanded={showHistory}
            >
              <span className="text-sm font-semibold">
                更新日志与历史版本
              </span>
              <ChevronDown
                className={cn(
                  "h-4 w-4 text-muted-foreground transition-transform",
                  showHistory && "rotate-180"
                )}
              />
            </button>
            {showHistory && (
              <div className="border-t">
                {/* 当前版本 changelog */}
                {props.changelogMarkdown && (
                  <article className="prose prose-sm dark:prose-invert max-w-none px-4 py-3">
                    <MarkdownLite source={props.changelogMarkdown} />
                  </article>
                )}

                {/* 历史版本时间线 */}
                {props.history && props.history.length > 0 && (
                  <ol className="divide-y">
                    {props.history.map((h, i) => (
                      <li key={i} className="flex items-center justify-between gap-3 px-4 py-3 text-xs">
                        <div className="min-w-0">
                          <div className="font-medium">v{h.version}</div>
                          <div className="truncate text-muted-foreground">
                            {h.platformLabel} · {formatSize(h.fileSizeBytes)} · {formatDate(h.releasedAt)}
                          </div>
                        </div>
                        <a
                          href={h.downloadUrl}
                          download
                          className="inline-flex shrink-0 items-center gap-1 rounded-md border px-2 py-1 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                        >
                          <Download className="h-3 w-3" />
                          下载
                        </a>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            )}
          </div>
        </section>
      )}

      {/* 底部引导 */}
      <section className="border-t bg-muted/30">
        <div className="mx-auto max-w-3xl px-4 py-10 text-center sm:px-6">
          <h2 className="text-base font-semibold">还没有 License？</h2>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            下载安装后，可在控制台购买 License 完成激活，立即开始创作。
          </p>
          <div className="mt-4 flex justify-center gap-2">
            <Button asChild>
              <Link href="/#pricing">查看套餐</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/guide">使用指引</Link>
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}

function RecommendedDownload({
  platform,
}: {
  platform: DownloadsPlatform | null;
}) {
  if (!platform) return null;
  return (
    <Button size="lg" asChild className="h-12 gap-2 px-8 text-base shadow-md">
      <a href={platform.downloadUrl} download>
        <Download className="h-5 w-5" />
        下载 for {platform.label} · {formatSize(platform.fileSizeBytes)}
      </a>
    </Button>
  );
}

/**
 * 极简 Markdown 渲染（changelog 通常只是 # 标题 + bullet list + 段落）。
 * 不引入 react-markdown 依赖，避免 bundle 体积膨胀。
 */
function MarkdownLite({ source }: { source: string }) {
  const lines = source.split("\n");
  const elements: React.ReactNode[] = [];
  let listBuffer: string[] = [];

  const flushList = () => {
    if (listBuffer.length > 0) {
      elements.push(
        <ul key={`ul-${elements.length}`} className="my-2 list-disc pl-5">
          {listBuffer.map((item, i) => (
            <li key={i}>{item.replace(/^[-*]\s+/, "")}</li>
          ))}
        </ul>
      );
      listBuffer = [];
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (/^#{1,3}\s+/.test(line)) {
      flushList();
      const level = (line.match(/^(#{1,3})/)?.[1] ?? "#").length;
      const text = line.replace(/^#{1,3}\s+/, "");
      if (level === 1) {
        elements.push(
          <h3 key={i} className="mb-2 mt-3 text-lg font-semibold">
            {text}
          </h3>
        );
      } else if (level === 2) {
        elements.push(
          <h4 key={i} className="mb-1 mt-2 text-base font-medium">
            {text}
          </h4>
        );
      } else {
        elements.push(
          <h5 key={i} className="mb-1 mt-2 text-sm font-medium">
            {text}
          </h5>
        );
      }
    } else if (/^[-*]\s+/.test(line)) {
      listBuffer.push(line);
    } else if (line.trim() === "") {
      flushList();
    } else {
      flushList();
      elements.push(
        <p key={i} className="my-1 text-sm leading-relaxed">
          {line}
        </p>
      );
    }
  }
  flushList();

  return <>{elements}</>;
}
