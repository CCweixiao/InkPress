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
