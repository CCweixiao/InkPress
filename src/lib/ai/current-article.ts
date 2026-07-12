/**
 * 「当前文章」相关识别与文案（route.ts 本地短路 + 系统提示共用）。
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
  /当前(?:文章|正文|内容|这篇|编辑区|编辑器|文档)|本(?:文章|文档|内容|正文)|这(?:篇|份)(?:文章|正文|文档|内容)|上面的?(?:文章|正文|内容|这篇)|现有(?:文章|正文|文档)|原文章?|编辑区(?:里的?)?(?:文章|正文|内容|这篇)|当前这篇/i;

const ARTICLE_OPERATION =
  /(?:润色|改写|修改|编辑|处理|优化|扩写|缩写|精简|总结|摘要|提炼|审校|校对|翻译|排版|重写|续写|补全|检查|分析|评价|点评|调整|完善|整理|拆解|复盘|生成|提取|压缩)/;
const STANDALONE_CURRENT_TEXT_PATTERN =
  new RegExp(
    `(?:${ARTICLE_OPERATION.source}.{0,12}本文|本文.{0,12}${ARTICLE_OPERATION.source})`,
    "i"
  );

export function referencesCurrentArticle(raw: string): boolean {
  if (!raw) return false;
  const text = raw.trim();
  return (
    CURRENT_ARTICLE_PATTERN.test(text) ||
    STANDALONE_CURRENT_TEXT_PATTERN.test(text)
  );
}

/**
 * 指代当前文章但正文为空时的提示（本地短路回执）。
 * 兼顾两种真实成因：编辑区确实空 / 内容尚未同步过来——都引导用户先写入或粘贴。
 */
export const EMPTY_ARTICLE_REPLY = `我这边还没读到当前文章的正文——编辑区的内容可能还在保存，或者文章目前是空的。

可以稍等一两秒再发送一次；如果还是不行，直接把要处理的正文粘贴给我，我来帮你处理。`;

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
