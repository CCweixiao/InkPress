import type { LucideIcon } from "lucide-react";

/**
 * 渠道产出形态：
 * - api-push：通过平台开放 API 直接发布（如微信推草稿箱）
 * - export-html：产出可粘贴的全内联 HTML（知乎/掘金/博客园等无开放写入 API 的平台）
 */
export type ChannelKind = "api-push" | "export-html";

/**
 * 渠道 HTML 后处理（服务端执行）。
 * 实现见 channels/finalize.ts，刻意与元数据分文件存放。
 */
export type ChannelFinalize = (
  inlinedHtml: string,
  primaryColor: string
) => string;

/** 渠道凭证需求：决定是否在 settings-nav 的「发布渠道配置」分组下出现配置页。 */
export type CredentialRequirement =
  | { required: false }
  | { required: true; configKey: string };

/**
 * 渠道元数据（客户端安全）。
 *
 * 刻意不含 finalize 函数——finalize 依赖 to-wechat → render-inline → prisma
 * (better-sqlite3)，会拉入 Node 原生模块，不能进客户端 bundle。
 * 客户端组件请 import from "@/lib/publish/channels/meta"。
 */
export interface ChannelMeta {
  /** 唯一稳定 id，用于 API 路由参数与前端 state */
  id: string;
  /** 中文显示名 */
  label: string;
  /** lucide 图标组件（渠道选择器卡片用） */
  icon: LucideIcon;
  /** 产出形态 */
  kind: ChannelKind;
  /** 是否需要图片预处理上传 */
  needsImageUpload: boolean;
  /** 凭证需求 */
  credentials: CredentialRequirement;
  /** 发布/粘贴指引文案，前端面板展示 */
  publishHint: string;
}
