import {
  MessageCircle,
  BookOpen,
  Code2,
  FileText,
  Globe,
} from "lucide-react";
import type { ChannelMeta } from "./types";

// 对外暴露类型，客户端统一从本文件导入
export type {
  ChannelMeta,
  ChannelKind,
  CredentialRequirement,
} from "./types";

/**
 * 渠道元数据注册表（客户端安全：仅纯数据 + lucide 图标，无 Node 依赖）。
 *
 * 新增渠道在此追加一项；其 finalize 实现需同步在 channels/finalize.ts 注册。
 */
export const CHANNELS: ChannelMeta[] = [
  {
    id: "wechat",
    label: "微信公众号",
    icon: MessageCircle,
    kind: "api-push",
    needsImageUpload: true,
    credentials: { required: true, configKey: "wechat" },
    publishHint: "推送到公众号草稿箱后，需在公众号后台「群发」才正式发布。",
  },
  {
    id: "zhihu",
    label: "知乎",
    icon: BookOpen,
    kind: "export-html",
    needsImageUpload: false,
    credentials: { required: false },
    publishHint:
      "复制下方 HTML，粘贴到知乎文章编辑器（富文本模式）即可保留排版。",
  },
  {
    id: "juejin",
    label: "掘金",
    icon: Code2,
    kind: "export-html",
    needsImageUpload: false,
    credentials: { required: false },
    publishHint: "复制下方 HTML，粘贴到掘金写作中心的编辑器。",
  },
  {
    id: "bokeyuan",
    label: "博客园",
    icon: FileText,
    kind: "export-html",
    needsImageUpload: false,
    credentials: { required: false },
    publishHint: "复制下方 HTML，切换到博客园编辑器的 HTML 源码模式粘贴。",
  },
  {
    id: "generic",
    label: "通用 HTML",
    icon: Globe,
    kind: "export-html",
    needsImageUpload: false,
    credentials: { required: false },
    publishHint: "通用全内联 HTML，可粘贴到任意支持 HTML 的编辑器。",
  },
];

const CHANNEL_MAP = new Map(CHANNELS.map((c) => [c.id, c] as const));

/** 按 id 取渠道元数据；未知 id 返回 undefined。 */
export function getChannelMeta(id: string): ChannelMeta | undefined {
  return CHANNEL_MAP.get(id);
}

/** 全部渠道（渠道选择器网格用）。 */
export function allChannelMeta(): ChannelMeta[] {
  return CHANNELS;
}
