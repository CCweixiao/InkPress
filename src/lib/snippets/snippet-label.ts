/**
 * 回收站行标题回退：title → content 首个非空行（截断 40）→ 占位。
 * 纯函数，无副作用，客户端可安全 import（不拉 Node 依赖）。
 */
export function pickSnippetLabel(title: string, content: string): string {
  const t = title?.trim();
  if (t) return t;
  const firstLine = content
    ?.split("\n")
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  if (firstLine) return firstLine.slice(0, 40);
  return "（无内容）";
}
