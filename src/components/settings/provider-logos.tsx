import type { SVGProps } from "react";
import { cn } from "@/lib/utils";

/**
 * 模型供应商 Logo（自包含 SVG，无网络依赖）。
 *
 * 每家供应商用「品牌色圆角方块 + 白色识别图形」呈现，统一样式，
 * 形如浏览器 favicon / 工作区图标，在 16–20px 仍清晰可辨。
 * 自定义供应商（id 未命中预设）回落到中性灰底 + 通用芯片图形。
 */

/** 各供应商品牌底色（取自官方主视觉，便于用户快速识别） */
const BRAND_COLOR: Record<string, string> = {
  openai: "#10A37F", // OpenAI / ChatGPT 标志性青绿
  deepseek: "#4D6BFE", // DeepSeek 蓝
  "zhipu-glm": "#1666E8", // 智谱 GLM 蓝
  dashscope: "#7C3AED", // 通义千问 / 百炼 紫
  openrouter: "#475569", // OpenRouter 中性石板灰
  azure: "#0078D4", // Microsoft Azure 蓝
  ollama: "#111827", // Ollama 近黑
  "moonshot-kimi": "#0E7C86", // Kimi（月之暗面）青绿
  minimax: "#5B5BD6", // MiniMax 靛紫
};

/** 白色识别图形（统一缩放到方块内留出 padding） */
function BrandGlyph({ id }: { id: string }) {
  switch (id) {
    case "openai":
      // OpenAI 官方「绳结」标志（单色 path，源自公开 brand 资源）
      return (
        <path
          fill="#fff"
          d="M22.28 9.82a5.98 5.98 0 0 0-.52-4.91 6.05 6.05 0 0 0-6.51-2.9A6.07 6.07 0 0 0 4.98 4.18a5.98 5.98 0 0 0-4 2.9 6.05 6.05 0 0 0 .74 7.1 5.98 5.98 0 0 0 .51 4.91 6.05 6.05 0 0 0 6.51 2.9A5.98 5.98 0 0 0 13.26 24a6.06 6.06 0 0 0 5.77-4.21 5.99 5.99 0 0 0 4-2.9 6.06 6.06 0 0 0-.75-7.07Zm-9.02 12.61a4.48 4.48 0 0 1-2.88-1.04l.14-.08 4.78-2.76a.79.79 0 0 0 .39-.68V7.73l2.02 1.17a.07.07 0 0 1 .04.05v5.58a4.5 4.5 0 0 1-4.49 4.49Zm-9.66-4.13a4.47 4.47 0 0 1-.53-3.01l.14.08 4.78 2.76a.77.77 0 0 0 .78 0l5.84-3.37v2.33a.08.08 0 0 1-.03.06L9.74 19.95a4.5 4.5 0 0 1-6.14-1.65ZM2.34 7.9a4.49 4.49 0 0 1 2.37-1.98V11.6a.77.77 0 0 0 .39.68l5.81 3.35-2.02 1.17a.08.08 0 0 1-.07 0L4 13.81A4.5 4.5 0 0 1 2.34 7.87Zm16.6 3.86-5.84-3.39L15.12 7.2a.08.08 0 0 1 .07 0l4.83 2.79a4.49 4.49 0 0 1-.67 8.1v-5.68a.79.79 0 0 0-.41-.65Zm2.01-3.02-.14-.09-4.77-2.78a.78.78 0 0 0-.79 0L9.41 9.23V6.9a.07.07 0 0 1 .03-.06l4.83-2.79a4.5 4.5 0 0 1 6.68 4.66ZM8.31 12.86l-2.02-1.16a.08.08 0 0 1-.04-.06V6.07a4.5 4.5 0 0 1 7.38-3.45l-.14.08-4.78 2.76a.79.79 0 0 0-.39.68Zm1.1-2.37 2.6-1.5 2.61 1.5v3l-2.6 1.5-2.61-1.5Z"
        />
      );
    case "deepseek":
      // 水滴（呼应 deep / seek 的深蓝色「深潜」意象）
      return (
        <path
          fill="#fff"
          d="M12 3.2s-5.4 6.1-5.4 10.3a5.4 5.4 0 0 0 10.8 0C17.4 9.3 12 3.2 12 3.2Zm-.7 14.1a3.6 3.6 0 0 1-3.6-3.6c0-1.5 1-3.1 2.1-4.5-.1.5-.2 1-.2 1.5a4.2 4.2 0 0 0 4.2 4.2c.4 0 .8 0 1.2-.2a3.6 3.6 0 0 1-3.7 2.6Z"
        />
      );
    case "zhipu-glm":
      // 四芒星（AI 闪光）
      return (
        <path
          fill="#fff"
          d="m12 2 1.7 8.3L22 12l-8.3 1.7L12 22l-1.7-8.3L2 12l8.3-1.7Z"
        />
      );
    case "dashscope":
      // 层叠平台（呼应「百炼」平台 / 通义千问）
      return (
        <g fill="#fff">
          <path d="M12 4 20 8l-8 4-8-4Z" />
          <path d="M4 11.6 12 15.6l8-4v1.5l-8 4-8-4Z" />
          <path d="M4 15.6 12 19.6l8-4v1.5l-8 4-8-4Z" />
        </g>
      );
    case "openrouter":
      // 三节点图（路由 / 中转）
      return (
        <g>
          <g stroke="#fff" strokeWidth="1.4" fill="none">
            <path d="M7.4 8.4 12 16.5" />
            <path d="M16.6 8.4 12 16.5" />
            <path d="M7.6 8.5h8.8" />
          </g>
          <g fill="#fff">
            <circle cx="7" cy="8" r="2.4" />
            <circle cx="17" cy="8" r="2.4" />
            <circle cx="12" cy="17" r="2.4" />
          </g>
        </g>
      );
    case "azure":
      // 字母 A（Microsoft Azure 标志）
      return (
        <path
          fill="#fff"
          fillRule="evenodd"
          clipRule="evenodd"
          d="M12 3 3 20h4.2l1.5-3.6h6.6L16.8 20H21Zm0 6.4 2.9 6.9H9.1Z"
        />
      );
    case "ollama":
      // 羊驼脸（Ollama 标志）——双耳 + 头部 + 双眼
      return (
        <g>
          <g fill="#fff">
            <path d="M8.3 4.2c.5 0 .9.7 1.1 2.2l.2 1.8c-.5-.1-1-.2-1.6-.2s-1.1.1-1.6.2l.2-1.8c.2-1.5.6-2.2 1.1-2.2Z" />
            <path d="M15.7 4.2c-.5 0-.9.7-1.1 2.2l-.2 1.8c.5-.1 1-.2 1.6-.2s1.1.1 1.6.2l-.2-1.8c-.2-1.5-.6-2.2-1.1-2.2Z" />
            <path d="M12 8.6c-3.4 0-5.6 2.1-5.6 4.7S8.6 18 12 18s5.6-2.1 5.6-4.7-2.2-4.7-5.6-4.7Zm-2 4.2a.9.9 0 1 1 0-1.8.9.9 0 0 1 0 1.8Zm4 0a.9.9 0 1 1 0-1.8.9.9 0 0 1 0 1.8Z" />
          </g>
        </g>
      );
    case "moonshot-kimi":
      // 弯月（月之暗面 / Kimi）
      return (
        <path
          fill="#fff"
          d="M17 4A10 10 0 1 0 17 20A8 8 0 0 1 17 4Z"
        />
      );
    case "minimax":
      // 几何六边形（MiniMax）
      return (
        <path
          fill="#fff"
          d="M12 3 20 7.5v9L12 21 4 16.5v-9L12 3Zm0 3.5L7 9.75v4.5l5 3.25 5-3.25v-4.5L12 6.5Z"
        />
      );
    default:
      // 自定义供应商：通用芯片图形
      return (
        <g fill="none" stroke="#fff" strokeWidth="1.4">
          <rect x="7.5" y="7.5" width="9" height="9" rx="1.5" />
          <path d="M9.5 7.5V6M12 7.5V6M14.5 7.5V6M9.5 18v-1.5M12 18v-1.5M14.5 18v-1.5M7.5 9.5H6M7.5 12H6M7.5 14.5H6M18 9.5h-1.5M18 12h-1.5M18 14.5h-1.5" />
        </g>
      );
  }
}

export function ProviderLogo({
  id,
  className,
  ...props
}: { id: string } & SVGProps<SVGSVGElement>) {
  const color = BRAND_COLOR[id] ?? "#64748B";
  return (
    <svg
      viewBox="0 0 24 24"
      role="img"
      aria-label="供应商图标"
      className={cn("h-5 w-5 shrink-0 rounded-[5px]", className)}
      {...props}
    >
      <rect width="24" height="24" rx="5" fill={color} />
      <BrandGlyph id={id} />
    </svg>
  );
}
