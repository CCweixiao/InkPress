export const SYSTEM_PROMPT = `你是一位资深的公众号内容创作者，擅长把主题、要求与素材组织成结构清晰、可读性强的公众号文章。

写作要求：
- 输出纯 Markdown，不要包裹在代码块里，不要输出解释性前言
- 标题用一级标题（#），小节用二级/三级标题（## / ###）
- 段落简洁，多用短句；适当使用有序/无序列表、加粗、引用增强可读性
- 代码示例用带语言标记的代码块（如 \`\`\`js）
- 若提供了参考素材，优先基于素材事实展开，不要编造数据或引用
- 公众号正文不支持外链跳转，避免依赖"点击这里"类表述
- 控制篇幅在 1500–3000 字之间，结尾给出简短总结或行动建议`;

export function buildUserMessage(input: {
  topic: string;
  requirements?: string;
  materials?: string;
  length?: string;
}): string {
  const parts: string[] = [];
  parts.push(`【文章主题】\n${input.topic}`);
  if (input.requirements?.trim()) {
    parts.push(`【写作要求】\n${input.requirements}`);
  }
  if (input.materials?.trim()) {
    parts.push(`【参考素材】\n${input.materials}`);
  }
  if (input.length?.trim()) {
    parts.push(`【篇幅】${input.length}`);
  }
  parts.push("请根据以上信息撰写完整的公众号文章。");
  return parts.join("\n\n");
}

/** 大纲生成系统提示词 */
export const OUTLINE_SYSTEM_PROMPT = `你是一位公众号内容策划。根据主题、要求与素材，规划一篇结构清晰的文章大纲。

要求：
- 标题精炼有吸引力
- 切分为 3-8 个逻辑递进的小节
- 每节给出该节要覆盖的要点（1-2 句话），便于后续逐节展开
- 不要编造素材中没有的事实`;

export function buildOutlineMessage(input: {
  topic: string;
  requirements?: string;
  materials?: string;
}): string {
  const parts: string[] = [];
  parts.push(`【主题】${input.topic}`);
  if (input.requirements?.trim()) parts.push(`【要求】${input.requirements}`);
  if (input.materials?.trim()) parts.push(`【素材】${input.materials}`);
  parts.push("请输出文章大纲。");
  return parts.join("\n");
}

/** 单节展开系统提示词 */
export const SECTION_SYSTEM_PROMPT = `你是公众号写手，根据给定的小节标题与要点，撰写该小节正文（Markdown）。

要求：
- 只输出该小节正文，以二级标题 ## 开头
- 不要输出其他小节或前言
- 200-500 字，段落简洁，可用列表/加粗/引用
- 基于要点展开，不编造数据`;

export function buildSectionMessage(
  articleTitle: string,
  section: { heading: string; summary: string },
  context: { requirements?: string; materials?: string }
): string {
  const parts: string[] = [];
  parts.push(`【文章标题】${articleTitle}`);
  parts.push(`【本节标题】${section.heading}`);
  parts.push(`【本节要点】${section.summary}`);
  if (context.requirements?.trim()) parts.push(`【整体要求】${context.requirements}`);
  if (context.materials?.trim()) parts.push(`【参考素材】${context.materials}`);
  parts.push("请撰写本节正文。");
  return parts.join("\n");
}
