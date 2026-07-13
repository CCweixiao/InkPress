import type { LucideIcon } from "lucide-react";
import { Bot, Sparkles, Cloud, Share2, MessageCircle, ScrollText, Globe2, Coins, Palette, KeyRound, ScanSearch } from "lucide-react";

/** 配置模块 Tab 键（与 SystemConfigManager 保持同步） */
export type ConfigTab = "llm" | "agent" | "web" | "storage" | "wechat" | "embedding";

/** 设置导航项的完整键集合：配置模块 + 主题 + 系统日志 + Token 消耗大盘 */
export type SettingsKey = ConfigTab | "theme" | "license" | "logs" | "usage";

/** 叶子节点：对应一个具体配置/视图 */
export type NavLeaf = {
  kind: "leaf";
  key: SettingsKey;
  label: string;
  description: string;
  icon: LucideIcon;
};

/** 分组节点：可折叠的父级，包含若干子节点 */
export type NavGroup = {
  kind: "group";
  key: string;
  label: string;
  description: string;
  icon: LucideIcon;
  /** 默认是否展开 */
  defaultOpen?: boolean;
  children: NavLeaf[];
};

export type NavNode = NavLeaf | NavGroup;

/** 设置页左侧树状导航配置（数据驱动，便于后续扩展发布渠道等新模块） */
export const SETTINGS_NAV: NavNode[] = [
  {
    kind: "leaf",
    key: "agent",
    label: "写作 Agent",
    description: "配置写作流程使用的 Agent 模型、提示词与执行参数。",
    icon: Bot,
  },
  {
    kind: "leaf",
    key: "web",
    label: "联网搜索",
    description: "配置 Tavily 联网搜索；网页正文抓取默认自动放行公开网址。",
    icon: Globe2,
  },
  {
    kind: "leaf",
    key: "llm",
    label: "AI 模型",
    description: "配置 AI 模型供应商与凭证，支持多模型切换与加密导出。",
    icon: Sparkles,
  },
  {
    kind: "leaf",
    key: "embedding",
    label: "向量检索",
    description: "配置 OpenAI 兼容 embedding 供应商，为素材块生成语义向量以支持语义检索。",
    icon: ScanSearch,
  },
  {
    kind: "leaf",
    key: "storage",
    label: "存储配置",
    description: "配置素材存储位置（本地路径 / OSS 等多 provider）。",
    icon: Cloud,
  },
  {
    kind: "leaf",
    key: "theme",
    label: "主题管理",
    description: "管理文章排版主题：内置主题可编辑，支持自定义 CSS、代码高亮与主题色。",
    icon: Palette,
  },
  {
    kind: "leaf",
    key: "license",
    label: "License",
    description: "查看激活状态、手动刷新校验，并释放本机设备席位。",
    icon: KeyRound,
  },
  {
    kind: "group",
    key: "publish",
    label: "发布渠道配置",
    description: "管理各发布渠道的接入凭证与参数。",
    icon: Share2,
    defaultOpen: true,
    children: [
      {
        kind: "leaf",
        key: "wechat",
        label: "微信公众号",
        description: "管理多个公众号的认证信息、默认账号与发布状态。",
        icon: MessageCircle,
      },
    ],
  },
  {
    kind: "leaf",
    key: "logs",
    label: "系统日志",
    description: "实时查看系统运行日志，支持按级别筛选、关键词搜索与实时刷新。",
    icon: ScrollText,
  },
  {
    kind: "leaf",
    key: "usage",
    label: "Token 消耗",
    description: "查看按对话轮次汇总的 token 与估算成本：KPI、趋势、热力图、洞察与明细。",
    icon: Coins,
  },
];

/** 扁平化所有叶子节点，便于按键查找标题/描述 */
export function findNavNode(key: SettingsKey): NavLeaf | undefined {
  for (const node of SETTINGS_NAV) {
    if (node.kind === "leaf" && node.key === key) return node;
    if (node.kind === "group") {
      const child = node.children.find((c) => c.key === key);
      if (child) return child;
    }
  }
  return undefined;
}
