"use client";

import { useEffect, useState } from "react";
import { Check, X, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

type Status = {
  hasWxAppid: boolean;
  hasWxSecret: boolean;
  hasAnthropicKey: boolean;
  hasOpenaiKey: boolean;
  aiModel: string;
};

export function SettingsForm() {
  const [status, setStatus] = useState<Status | null>(null);
  const [loading, setLoading] = useState(true);

  async function refresh() {
    setLoading(true);
    const res = await fetch("/api/settings/status");
    const data = await res.json();
    setStatus(data);
    setLoading(false);
  }

  useEffect(() => {
    refresh();
  }, []);

  if (loading || !status) {
    return <div className="text-sm text-muted-foreground">加载中…</div>;
  }

  const items: {
    label: string;
    ok: boolean;
    hint: string;
    env: string;
  }[] = [
    {
      label: "微信 AppID",
      ok: status.hasWxAppid,
      hint: "微信公众平台 → 设置与开发 → 基本配置",
      env: "WX_APPID",
    },
    {
      label: "微信 Secret",
      ok: status.hasWxSecret,
      hint: "同上，开发者密码（AppSecret）",
      env: "WX_SECRET",
    },
    {
      label: "Anthropic API Key",
      ok: status.hasAnthropicKey,
      hint: "console.anthropic.com，用于 Claude 模型",
      env: "ANTHROPIC_API_KEY",
    },
    {
      label: "OpenAI API Key",
      ok: status.hasOpenaiKey,
      hint: "platform.openai.com，用于 GPT 模型（可选）",
      env: "OPENAI_API_KEY",
    },
  ];

  return (
    <div className="space-y-4">
      <div className="rounded-md border border-border divide-y">
        {items.map((item) => (
          <div
            key={item.env}
            className="flex items-center justify-between px-4 py-3"
          >
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">{item.label}</span>
                <code className="text-xs text-muted-foreground">{item.env}</code>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">{item.hint}</p>
            </div>
            {item.ok ? (
              <span className="inline-flex items-center gap-1 text-xs text-emerald-600">
                <Check className="h-4 w-4" />
                已配置
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-xs text-amber-600">
                <X className="h-4 w-4" />
                未配置
              </span>
            )}
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between">
        <div className="text-sm">
          <span className="text-muted-foreground">当前 AI 模型：</span>
          <code className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">
            {status.aiModel}
          </code>
        </div>
        <Button variant="outline" size="sm" onClick={refresh}>
          <RefreshCw className="h-4 w-4" />
          刷新状态
        </Button>
      </div>

      <div className="rounded-md bg-amber-50 border border-amber-200 p-3 text-xs text-amber-700">
        提示：修改 <code>.env</code> 后需重启 <code>pnpm dev</code> 才会生效。
        微信相关接口还需在公众平台「基本配置 → IP 白名单」中加入本机出口 IP。
      </div>
    </div>
  );
}
