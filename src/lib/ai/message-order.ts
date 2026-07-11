type AgentMessagePart = {
  type?: string;
  toolName?: string;
  output?: unknown;
};

export function isArticleProposalPart(part: AgentMessagePart): boolean {
  const toolName =
    part.type === "dynamic-tool"
      ? part.toolName
      : part.type?.startsWith("tool-")
        ? part.type.slice(5)
        : part.toolName;
  return toolName === "propose_article_revision";
}

/** 提案审核必须位于本轮总结之后，避免工具先返回时把审核卡顶到过程消息中间。 */
export function moveProposalPartsToEnd<T extends AgentMessagePart>(
  parts: T[]
): T[] {
  const regular: T[] = [];
  const proposals: T[] = [];
  for (const part of parts) {
    (isArticleProposalPart(part) ? proposals : regular).push(part);
  }
  return proposals.length ? [...regular, ...proposals] : parts;
}
