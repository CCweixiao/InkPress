/**
 * 「当前文章」相关识别与文案（route.ts 预路由 + 指令强化共用）。
 *
 * 用户说「对当前文章生成摘要」「润色本文」「改写下第三节」时，期望对编辑器里正在编辑的
 * 现有正文操作。route.ts 据此：正文为空 → 直接明确提示（不让 Agent 反问/臆断）；
 * 正文非空 → 写「已载入当前文章」步骤 + 指令强化（注入的正文就是当前文章，按标题定位章节）。
 */

/**
 * 识别用户消息是否指代「当前正在编辑的文章/文档」。
 * 整词匹配，避免误伤「这篇文章不错」（口语评价）之类的非操作语境——
 * 保守起见，要求带「当前/本/这/上面/现有/原文」等限定词。
 */
const CURRENT_ARTICLE_PATTERN =
  /当前(?:文章|正文|内容|这篇|编辑区|编辑器|文档)|本文(?:章|档|内容|正文)?|这(?:篇|份)(?:文章|正文|文档|内容)|上面的?(?:文章|正文|内容|这篇)|现有(?:文章|正文|文档)|原文章?|编辑区(?:里的?)?(?:文章|正文|内容|这篇)|当前这篇/i;

export function referencesCurrentArticle(raw: string): boolean {
  if (!raw) return false;
  return CURRENT_ARTICLE_PATTERN.test(raw.trim());
}

/**
 * 指代当前文章但正文为空时的提示（预路由短路回执）。
 * 兼顾两种真实成因：编辑区确实空 / 内容尚未同步过来——都引导用户先写入或粘贴。
 */
export const EMPTY_ARTICLE_REPLY = `我这边还没读到当前文章的正文——编辑区的内容可能还在保存，或者文章目前是空的。

可以稍等一两秒再发送一次；如果还是不行，直接把要处理的正文粘贴给我，我来帮你处理。`;

/**
 * 与「当前文章正文」无关的意图：输入来自网络或代码项目，不需要把现有正文喂给模型。
 * 命中这些意图且用户未指代当前文章时，按需省略全文，只带轻量摘要，省 token。
 * 其余意图（摘要/润色/审校/改写/续写/创作等）默认带全文，避免重蹈「正文消失」。
 */
const ARTICLE_INDEPENDENT_INTENTS = new Set<string>([
  "research",
  "project-explore",
  "project-change-analysis",
  "write-change-document",
  "out-of-scope",
]);

/**
 * 判定本轮是否应把文章全文注入系统提示。
 * 保守策略：默认带全文；仅当意图明显与正文无关（联网/代码）且用户未指代当前文章时才省略。
 */
export function shouldIncludeArticleBody(
  intent: string,
  referencesArticle: boolean
): boolean {
  return referencesArticle || !ARTICLE_INDEPENDENT_INTENTS.has(intent);
}

/** 提取 markdown 标题大纲（ATX #/##/###/####），用于省略全文时的轻量摘要。 */
export function extractArticleOutline(markdown: string, max = 15): string[] {
  if (!markdown) return [];
  const headings: string[] = [];
  for (const line of markdown.split("\n")) {
    const m = line.match(/^\s{0,3}(#{1,4})\s+(.+?)\s*#*\s*$/);
    if (!m) continue;
    const level = m[1].length;
    const text = m[2].replace(/[*_`]/g, "").trim();
    if (!text) continue;
    headings.push(`${"  ".repeat(level - 1)}${"#".repeat(level)} ${text}`.slice(0, 64));
    if (headings.length >= max) break;
  }
  return headings;
}
