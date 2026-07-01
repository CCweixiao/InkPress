/**
 * Article Type Profile（P3）。文章类型 profile —— 影响 system-prompt 注入（风格/结构/工具偏好/checklist）
 * + 默认 Skill 建议（合并进 preferredSkillIds）。
 *
 * 设计依据：docs/agent-runtime-pdc.md §7。
 * **聚焦边界**：profile 只做 prompt 引导（建议），**不改权限链路**（不禁用/强制工具，那留 P5）。
 * profile 由用户新建文章时选择；老文章（profileId=null）回落默认。
 */

export type ArticleTypeProfile = {
  id: string;
  name: string;
  description: string;
  /** 理想情况下优先加载的 Skill id（不存在则被 system-prompt 的 preferredSkillSection 自动过滤）。 */
  defaultSkills: string[];
  /** 注入 system-prompt「写作类型」段的风格/结构引导（markdown 纯文本）。 */
  promptSection: string;
  /** 审稿 checklist（注入 prompt 让 agent 自检；未来可供提案卡展示）。 */
  checklist: string[];
};

export const DEFAULT_ARTICLE_PROFILE = "wechat_essay";

export const ARTICLE_TYPE_PROFILES: Record<string, ArticleTypeProfile> = {
  wechat_essay: {
    id: "wechat_essay",
    name: "公众号观点/经验",
    description: "面向公众号读者的观点文或经验分享。",
    defaultSkills: ["wechat-writing"],
    promptSection:
      "面向公众号读者。开篇 3 句内用痛点/反差/悬念切入；段落短（建议 ≤4 行），口语化但有节奏；观点鲜明，结合亲身经验或具体案例；适当用加粗/列表/小标题增强可读性；保持移动端阅读节奏，避免大段文字墙。",
    checklist: [
      "开篇 3 句内切入主题",
      "有明确观点或结论",
      "段落 ≤4 行，无大段文字墙",
      "有亲历细节或具体案例支撑",
      "若 article_assets 有素材，至少配 1 张图",
    ],
  },
  technical_deep_dive: {
    id: "technical_deep_dive",
    name: "技术深度",
    description: "有代码/架构证据的技术深度文。",
    defaultSkills: ["technical-deep-dive"],
    promptSection:
      "技术深度文，必须有代码/架构证据。先用代码探索工具（project_overview / project_read / git_log / git_diff_summary）取证，再下结论；严格区分事实（代码/git 证据）与推断；结构建议：背景 → 方案/架构 → 代码证据 → 权衡/替代方案；必要时用 Mermaid 画架构图或调用链；关键结论要能回溯到具体代码位置。",
    checklist: [
      "有代码或 git 证据（project_read / git_log 等）",
      "明确区分事实与推断",
      "讨论了权衡或替代方案",
      "架构图/调用链（若适用）",
      "关键结论有代码位置可回溯",
    ],
  },
  product_update: {
    id: "product_update",
    name: "产品更新/版本说明",
    description: "基于版本变更的产品更新文。",
    defaultSkills: [],
    promptSection:
      "产品更新/版本说明。用 git_log / git_diff_summary 梳理本次版本变更，但要**从用户视角讲价值**（解决了什么、带来什么好处），而非堆砌 commit；结构建议：本次亮点 → 变更清单（按用户可感知的功能分组）→ 升级/兼容说明。",
    checklist: [
      "基于 git 变更范围（git_log / git_diff_summary）",
      "用用户视角讲价值，不堆 commit",
      "变更按功能分组",
      "有升级/兼容性说明（若适用）",
    ],
  },
  tutorial: {
    id: "tutorial",
    name: "教程/操作指南",
    description: "步骤化的操作教程。",
    defaultSkills: [],
    promptSection:
      "操作教程。步骤化、编号清晰；每步给出前置条件和预期结果；关键步骤配截图/素材（article_assets）辅助；结尾给「常见坑/故障排查」。面向能跟着做的新手，不要跳步。",
    checklist: [
      "步骤编号清晰",
      "每步有前置条件",
      "关键步骤配截图/素材（若有）",
      "结尾有常见坑或排错",
    ],
  },
  news_commentary: {
    id: "news_commentary",
    name: "热点评论",
    description: "基于最新事实的热点评论。",
    defaultSkills: [],
    promptSection:
      "热点评论。先用 web_search 取最新事实，再用 web_fetch 抓正文核实，立场鲜明但要有据；严格区分事实（带来源）与观点；结构建议：事件 → 背景 → 我的观点 → 展望。不臆测未经核实的信息。",
    checklist: [
      "用 web_search / web_fetch 取最新事实",
      "事实与观点严格分开",
      "每条关键事实有来源链接",
      "立场鲜明",
    ],
  },
  case_study: {
    id: "case_study",
    name: "案例复盘",
    description: "结构化的案例复盘。",
    defaultSkills: [],
    promptSection:
      "案例复盘。结构：背景 → 做法 → 结果 → 反思；用数据/素材/代码证据佐证；诚实讨论局限与教训，避免美化；讲清因果关系。",
    checklist: [
      "背景 → 做法 → 结果 → 反思 结构完整",
      "有数据或证据佐证",
      "讨论了局限或教训",
      "因果清晰，不美化",
    ],
  },
};

/** 取 profile；未知/空 id 回落默认。 */
export function getArticleProfile(id?: string | null): ArticleTypeProfile {
  const key = typeof id === "string" && id ? id : DEFAULT_ARTICLE_PROFILE;
  return ARTICLE_TYPE_PROFILES[key] ?? ARTICLE_TYPE_PROFILES[DEFAULT_ARTICLE_PROFILE];
}

/** 新建文章 UI 的选项列表（顺序即展示顺序）。 */
export const ARTICLE_PROFILE_OPTIONS = Object.values(ARTICLE_TYPE_PROFILES).map(
  (p) => ({ id: p.id, name: p.name, description: p.description })
);
