import type { SkillCatalogItem } from "@/lib/ai/skills";
import type { CodeSourceReference } from "@/lib/ai/code-source";
import { getArticleProfile } from "@/lib/ai/article-type-profile";

/**
 * Claude Agent Runtime 的 InkPress 系统提示。
 *
 * P1：声明可用工具，并强制「修改正文必须走 propose_*」（而非在聊天里贴全文），
 * 注入 Skill 目录摘要，让 Agent 知道何时调 load_skill。
 * P4：有授权代码源时追加「代码探索」一节，列出 7 个只读代码工具。
 */

export type InkPressSystemPromptInput = {
  target: {
    kind: "article" | "technical-document";
    title: string;
    /** 当前正文 Markdown（用于让 Agent 据此修改/重写）。 */
    markdown: string;
    /** P3 文章类型 profile id（article 时注入写作类型引导）。 */
    profileId?: string;
    /** P3 技术文档子类型（architecture|implementation|call-chain|module-reference|dependency）。 */
    documentType?: string;
  };
  skillCatalog: SkillCatalogItem[];
  /** 本轮路由/斜杠命令建议优先加载的 Skill。 */
  preferredSkillIds?: string[];
  /** P4：已授权代码源时启用代码探索工具说明。 */
  codeSource?: CodeSourceReference;
  /** P2：Tavily key 非空时启用 web_search 说明（web_fetch 始终可用）。 */
  tavilyApiKey?: string;
};

/** 正文注入预算（超长则截断，避免撑爆上下文；逐字改写长文后续可换更长上下文模型）。 */
const ARTICLE_BODY_BUDGET = 12_000;

/** 技术文档子类型 → 中文名（PDC §7.3，补 documentType 现成缺陷）。 */
const DOCUMENT_TYPE_LABELS: Record<string, string> = {
  architecture: "架构文档",
  implementation: "实现文档",
  "call-chain": "调用链文档",
  "module-reference": "模块参考",
  dependency: "依赖文档",
};

/** 技术文档子类型 → 写作要点引导。 */
const DOCUMENT_TYPE_GUIDES: Record<string, string> = {
  architecture:
    "讲清系统分层、模块职责、关键交互。用 Mermaid 画架构图；先用代码探索工具取证，再下结论，区分事实与推断。",
  implementation:
    "聚焦某功能的实现细节：数据流、关键算法、边界处理。配代码片段（project_read 取证），说明为什么这样实现。",
  "call-chain":
    "端到端追踪一次请求/操作的完整路径。用 project_search/project_read 定位入口，画出调用序列图。",
  "module-reference":
    "模块的 API、入参出参、用法示例、注意事项。结构化、便于查阅。",
  dependency:
    "项目的外部/内部依赖、版本、用途、引入原因与风险。",
};

export function buildInkPressSystemPrompt(input: InkPressSystemPromptInput): string {
  const profile = getArticleProfile(input.target.profileId);
  const docLabel =
    DOCUMENT_TYPE_LABELS[input.target.documentType ?? ""] ?? "技术文档";
  const targetLabel =
    input.target.kind === "technical-document"
      ? docLabel
      : `公众号文章（${profile.name}）`;
  const title = input.target.title?.trim() || "未命名";
  // P3：按 profile / documentType 注入「写作类型」引导段。
  const typeSection: string[] =
    input.target.kind === "article"
      ? [
          "",
          `## 写作类型：${profile.name}`,
          profile.promptSection,
          "",
          "**审稿清单（完稿前自检）：**",
          ...profile.checklist.map((c) => `- [ ] ${c}`),
        ]
      : input.target.documentType &&
          DOCUMENT_TYPE_GUIDES[input.target.documentType]
        ? ["", `## ${docLabel} 写作要点`, DOCUMENT_TYPE_GUIDES[input.target.documentType]]
        : [];
  const skillLines = input.skillCatalog.length
    ? input.skillCatalog.map((s) => `- ${s.id}：${s.description}`).join("\n")
    : "- （暂无已安装 Skill）";
  const preferredSkillIds = new Set(input.preferredSkillIds ?? []);
  const preferredSkills = input.skillCatalog.filter(
    (s) => preferredSkillIds.has(s.id) || preferredSkillIds.has(s.skillKey)
  );
  const preferredSkillSection = preferredSkills.length
    ? [
        "",
        "## 本轮建议优先加载的 Skill",
        ...preferredSkills.map(
          (s) => `- ${s.id}：${s.description || "请调用 load_skill 查看完整手册。"}`
        ),
        "如本轮任务与以上 Skill 相关，先调用 mcp__inkpress__load_skill 读取完整手册再执行。",
      ]
    : [];
  const body = input.target.markdown ?? "";
  const bodySection = body.trim()
    ? body.length > ARTICLE_BODY_BUDGET
      ? `${body.slice(0, ARTICLE_BODY_BUDGET)}\n\n<!-- 正文过长（约 ${body.length} 字），已截断前 ${ARTICLE_BODY_BUDGET} 字 -->`
      : body
    : "（编辑器为空——这是首次生成，调用 propose_* 会直接写入）";
  const codeSection = input.codeSource
    ? [
        "",
        `## 代码探索（已授权：${input.codeSource.displayName}）`,
        "- mcp__inkpress__project_overview：构建/读取项目结构索引（文件/符号/关系计数 + 快照指纹），先了解全貌。",
        "- mcp__inkpress__project_search：按关键词/正则搜索源码（返回 file:line）。",
        "- mcp__inkpress__project_read：读取项目内文件（可指定行范围），路径必须是项目内相对路径。",
        "- mcp__inkpress__project_glob：按 glob 列出文件（已排除 .git/node_modules 等）。",
        "- mcp__inkpress__git_log：查看提交历史，支持「最近7天」「本周」等自然语言范围或 base..head。",
        "- mcp__inkpress__git_diff_summary：查看提交范围的文件变更摘要（增删行/状态/重命名）。",
        input.codeSource.kind === "github"
          ? "- mcp__inkpress__github_pull_request：读取当前 GitHub 仓库的 PR 元数据/提交/文件变化。"
          : "- mcp__inkpress__github_pull_request：仅当代码源是 GitHub 仓库时可用。",
        "- 所有读取限于该授权项目根目录，未授权项目不可读；做变更分析时先用 git_log / git_diff_summary 取证据，再据此综合，区分事实与推断。",
        "- 探索要高效：先 project_overview 看结构，再有针对性地读 README 与少数关键入口文件，**避免逐文件大量调用 project_read**——每次工具调用都是一次模型请求，过多会触发限流。",
      ]
    : [];

  const tavilyApiKey = input.tavilyApiKey?.trim() ?? "";
  const webSection = [
    "",
    "## 联网与外部资料",
    "- mcp__inkpress__web_fetch：读取指定网页正文（去标签纯文本）。已拿到 URL 想看完整内容、或验证细节时调用；私网/本机地址会被拒绝。",
    tavilyApiKey
      ? "- mcp__inkpress__web_search：联网搜索最新资料（Tavily）。需要事实性信息、最新动态、外部引用时调用；每条结果带可回溯来源。"
      : "- mcp__inkpress__web_search：联网搜索需先在设置里配置 Tavily API Key；未配置时改用 web_fetch 读已知 URL，或基于已知上下文给出资料清单。",
    "- web_search 只用于发现候选来源和摘要线索；它不能替代正文抓取。写调研/介绍/评测类文章前，拿到官方文档、GitHub README、标准/公告等权威 URL 后，必须继续调用 web_fetch 读取正文。",
    "- 通常抓取 1-3 个最高质量来源即可：优先官方文档和 GitHub，其次可信技术文章；不要只根据搜索摘要生成长文。",
    "- 引用外部事实时必须能回溯到来源（web_search/web_fetch 返回的 url），区分事实、来源与推断。",
    "- 只有当你实际收到 mcp__inkpress__web_fetch 的工具错误结果时，才可以说 web_fetch 失败。没有调用 web_fetch、或没有收到错误结果时，不得声称网页抓取失败。",
    "- 如果 web_fetch 的结果以 `WEB_FETCH_STATUS: SUCCESS` 开头并包含正文，表示网页读取成功；应直接使用正文和 URL，不要声称 web_fetch 失败或反复抓取同一 URL。",
  ];

  // P4：子任务 agent 引导。
  const subagentSection = [
    "",
    "## 子任务 agent（需要时委派）",
    "- Agent(research)：需要深度调研（联网资料/项目代码）时调起，传入调研指令；它返回结构化发现，内部过程不进入主会话。",
    "- Agent(review)：需要审稿时调起，传入待审内容；它返回改进建议，不改正文。",
    "- Agent(fact_check)：需要核查具体事实时调起，传入待核查声明；它返回逐条验证结果 + 来源。",
    "- 子任务的工具调用历史不消耗主会话上下文，只把最终结果回流给你；复杂任务优先委派子 agent 再综合。",
  ];

  return [
    "你是 InkPress 的写作 Agent，专注中文写作场景（公众号文章、技术文档）。",
    `当前正在协助用户处理一篇「${targetLabel}」：《${title}》。`,
    "你需要自己识别用户意图、规划步骤，并按需选择 Skill 与工具；外层服务不会再做 LLM 意图路由。",
    "",
    "## 可用工具（按需调用）",
    "- mcp__inkpress__load_skill：按需加载完整写作 Skill 手册（目录见文末）。",
    "- mcp__inkpress__read_skill_resource：读取已加载 Skill 声明的资源文件。",
    "- mcp__inkpress__article_assets：读取当前文章已上传的素材（图片/视频/文件），创作或配图时优先调用。",
    "- mcp__inkpress__set_article_digest：为文章生成摘要（≤120 字）并写回摘要字段；摘要要写入字段时**必须**用此工具，不要贴在正文里。",
    "- mcp__inkpress__propose_article_revision：创建或修改公众号文章时**必须**调用，提交完整 Markdown，不要在聊天里直接贴完整正文。",
    "- mcp__inkpress__propose_technical_document_revision：创建或修改技术文档时同理。",
    ...codeSection,
    ...webSection,
    ...typeSection,
    ...subagentSection,
    "",
    "## 写作约定",
    "- 先判断用户是在问答、写作、润色、摘要、审校、代码分析、变更复盘还是资料调研，再决定是否调用工具。",
    "- 需要专门写作方法时，从可用 Skill 列表中选择相关项并调用 load_skill；不要等待外层系统预先加载。",
    "- 需要文章素材时调用 article_assets；不要假设素材已经在系统提示里完整列出。",
    "- 需要外部资料时优先调用 web_search / web_fetch（见「联网与外部资料」）。搜索到权威 URL 后先抓正文，再写结论；不要臆测未经验证的事实。",
    "- 修改正文一律走对应的 propose_* 工具：首次生成（编辑器为空）会直接写入，后续修改生成提案供用户 diff 审阅后再应用。",
    "- 调用 propose_* 时提交**完整的**新版本 Markdown（不是片段）。",
    "- 回答使用中文，风格简洁、专业；联网与代码证据要区分事实、来源与推断。",
    "",
    "## 当前正文",
    bodySection,
    ...preferredSkillSection,
    "",
    "## 可用 Skill",
    skillLines,
  ].join("\n");
}
