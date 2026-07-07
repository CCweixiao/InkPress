type MarkdownToken =
  | { type: "html"; value: string }
  | { type: "blank" };

/** 文档目录项：与渲染出的 <hN id="..."> 一一对应 */
export type GuideTocItem = {
  id: string;
  level: 1 | 2 | 3 | 4;
  text: string;
};

export type RenderedGuide = {
  html: string;
  toc: GuideTocItem[];
};

/** list item 续接段落的软换行占位符，formatInline 转成 <br> */
const SOFT_BREAK = "\u0001";

/**
 * 极简 Markdown 渲染器（仅覆盖 InkPress /guide 用到的语法）。
 *
 * 支持：标题 h1-h4、代码块、引用、表格、有序/无序列表（含缩进嵌套）、
 * 水平分割线 `---`/`***`/`___`、图片 `![alt](url)`、行内 `code` / `**bold** /
 * `[text](url)` / `*italic*` / `~~del~~`。
 *
 * 不支持（暂未使用）：任务列表 `- [x]`、脚注、定义列表、HTML 内联等。
 */
export function renderGuideMarkdown(markdown: string): RenderedGuide {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const tokens: MarkdownToken[] = [];
  const toc: GuideTocItem[] = [];
  let i = 0;
  let headingIndex = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) {
      tokens.push({ type: "blank" });
      i += 1;
      continue;
    }

    const fence = line.match(/^```(\w+)?\s*$/);
    if (fence) {
      const language = fence[1] ?? "text";
      const code: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i].startsWith("```")) {
        code.push(lines[i]);
        i += 1;
      }
      i += 1;
      tokens.push({
        type: "html",
        value: `<section class="guide-code"><div class="guide-code__bar"><span>${escapeHtml(language.toUpperCase())}</span></div><pre><code>${escapeHtml(code.join("\n"))}</code></pre></section>`,
      });
      continue;
    }

    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      const level = heading[1].length as 1 | 2 | 3 | 4;
      const text = heading[2].trim();
      const id = `heading-${headingIndex++}-${slugify(text)}`;
      toc.push({ id, level, text });
      tokens.push({
        type: "html",
        value: `<h${level} id="${id}">${formatInline(text)}</h${level}>`,
      });
      i += 1;
      continue;
    }

    // 水平分割线：--- / *** / ___（至少 3 个相同字符，允许空格）
    if (isThematicBreak(line)) {
      tokens.push({ type: "html", value: '<hr class="guide-hr" />' });
      i += 1;
      continue;
    }

    if (line.startsWith("> ")) {
      const quote: string[] = [];
      while (i < lines.length && (lines[i].startsWith("> ") || lines[i].trim() === ">")) {
        quote.push(lines[i].replace(/^>\s?/, ""));
        i += 1;
      }
      tokens.push({
        type: "html",
        value: `<blockquote>${formatInline(quote.join(" "))}</blockquote>`,
      });
      continue;
    }

    if (isTableStart(lines, i)) {
      const header = splitTableRow(lines[i]);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && /^\s*\|.+\|\s*$/.test(lines[i])) {
        rows.push(splitTableRow(lines[i]));
        i += 1;
      }
      tokens.push({
        type: "html",
        value: [
          '<div class="guide-table-wrap"><table><thead><tr>',
          header.map((cell) => `<th>${formatInline(cell)}</th>`).join(""),
          "</tr></thead><tbody>",
          rows
            .map((row) => `<tr>${row.map((cell) => `<td>${formatInline(cell)}</td>`).join("")}</tr>`)
            .join(""),
          "</tbody></table></div>",
        ].join(""),
      });
      continue;
    }

    // 有序/无序列表（含嵌套）
    if (isListItem(line)) {
      const result = parseListBlock(lines, i);
      tokens.push({ type: "html", value: result.html });
      i = result.next;
      continue;
    }

    const paragraph = [line.trim()];
    i += 1;
    while (
      i < lines.length &&
      lines[i].trim() &&
      !isThematicBreak(lines[i]) &&
      !/^(#{1,4})\s+/.test(lines[i]) &&
      !/^```/.test(lines[i]) &&
      !isListItem(lines[i]) &&
      !/^> /.test(lines[i]) &&
      !isTableStart(lines, i)
    ) {
      paragraph.push(lines[i].trim());
      i += 1;
    }
    tokens.push({
      type: "html",
      value: `<p>${formatInline(paragraph.join(" "))}</p>`,
    });
  }

  const html = tokens
    .filter((token, index, all) => token.type !== "blank" || all[index - 1]?.type !== "blank")
    .map((token) => (token.type === "html" ? token.value : ""))
    .join("\n");
  return { html, toc };
}

type ListType = "ul" | "ol";
type ListItem = { content: string; children: ListFrame[] };
type ListFrame = { type: ListType; items: ListItem[] };

/** 递归下降的 list parser，按 indent 处理嵌套 */
function parseListBlock(lines: string[], start: number): { html: string; next: number } {
  const parsed = parseListFrame(lines, start);
  return { html: renderListFrame(parsed.frame), next: parsed.next };
}

function parseListFrame(lines: string[], start: number): { frame: ListFrame; next: number } {
  const firstLine = lines[start];
  const baseIndent = lineIndent(firstLine);
  const baseType: ListType = /^\s*\d+\./.test(firstLine) ? "ol" : "ul";
  const items: ListItem[] = [];
  let i = start;

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) {
      const nextLine = lines[i + 1];
      // 空行 + 后续 indented 续接段落 / 嵌套子 list / 同 baseType list item：吸收空行
      if (nextLine) {
        const nextIndent = lineIndent(nextLine);
        if (nextIndent > baseIndent) {
          i += 1;
          continue;
        }
        if (isListItem(nextLine) && nextIndent === baseIndent) {
          const nextType: ListType = /^\s*\d+\./.test(nextLine) ? "ol" : "ul";
          if (nextType === baseType) {
            i += 1;
            continue;
          }
        }
      }
      break;
    }

    if (isListItem(line)) {
      const indent = lineIndent(line);
      const { type, content } = parseListItem(line);

      if (indent < baseIndent) break;

      if (indent === baseIndent) {
        // marker 类型变化（如 ol 接 ul），结束当前 list 让外层重启
        if (type !== baseType) break;
        items.push({ content, children: [] });
        i += 1;
        continue;
      }

      // indent > baseIndent：递归解析子 list，挂到上一个 item
      if (items.length === 0) items.push({ content: "", children: [] });
      const child = parseListFrame(lines, i);
      items[items.length - 1].children.push(child.frame);
      i = child.next;
      continue;
    }

    // indented 非空非 list 行：作为上一个 item 的续接段落（保持 list 序号不重置）
    if (lineIndent(line) > baseIndent && items.length > 0) {
      const last = items[items.length - 1];
      last.content = last.content
        ? `${last.content}${SOFT_BREAK}${line.trim()}`
        : line.trim();
      i += 1;
      continue;
    }

    break;
  }

  return { frame: { type: baseType, items }, next: i };
}

function renderListFrame(frame: ListFrame): string {
  const tag = frame.type;
  const items = frame.items
    .map((item) => {
      const childHtml = item.children.map(renderListFrame).join("");
      const contentHtml = item.content ? formatInline(item.content) : "";
      return `<li>${contentHtml}${childHtml}</li>`;
    })
    .join("");
  return `<${tag}>${items}</${tag}>`;
}

function parseListItem(line: string): { type: ListType; content: string } {
  const ulMatch = /^\s*[-*]\s+(.*)$/.exec(line);
  if (ulMatch) return { type: "ul", content: ulMatch[1].trim() };
  const olMatch = /^\s*\d+\.\s+(.*)$/.exec(line);
  if (olMatch) return { type: "ol", content: olMatch[1].trim() };
  return { type: "ul", content: line.trim() };
}

function isListItem(line: string): boolean {
  return /^\s*([-*]\s+|\d+\.\s+)/.test(line);
}

function lineIndent(line: string): number {
  const match = /^(\s*)/.exec(line);
  return match ? match[1].length : 0;
}

function isThematicBreak(line: string): boolean {
  // CommonMark: 一行仅由 3+ 个相同的 - / * / _ 组成，允许中间有空格，不能混用
  const stripped = line.trim().replace(/\s+/g, "");
  if (stripped.length < 3) return false;
  return /^(-{3,}|\*{3,}|_{3,})$/.test(stripped);
}

function formatInline(value: string): string {
  let html = escapeHtml(value);
  // list item 续接段落软换行 → <br>
  html = html.replace(/\u0001/g, "<br>");
  // 图片必须先于链接处理（避免 ![alt](url) 被 link regex 误匹配）
  html = html.replace(
    /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g,
    (_m, alt: string, src: string) => {
      const safeSrc = sanitizeImgSrc(src);
      return `<img alt="${escapeHtml(alt)}" src="${safeSrc}" loading="lazy" />`;
    },
  );
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/(^|[^*])\*([^*\s][^*]*?)\*(?!\*)/g, "$1<em>$2</em>");
  html = html.replace(/~~([^~]+)~~/g, "<del>$1</del>");
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, label: string, href: string) => {
    const safeHref = sanitizeHref(href);
    return `<a href="${safeHref}">${label}</a>`;
  });
  return html;
}

function isTableStart(lines: string[], index: number): boolean {
  return (
    /^\s*\|.+\|\s*$/.test(lines[index] ?? "") &&
    /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(lines[index + 1] ?? "")
  );
}

function splitTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function sanitizeHref(href: string): string {
  if (/^(https?:|mailto:|\/|#)/.test(href)) return escapeHtml(href);
  return "#";
}

function sanitizeImgSrc(src: string): string {
  if (/^(https?:|^\/|data:image\/)/i.test(src)) return escapeHtml(src);
  return "";
}

function slugify(value: string): string {
  return encodeURIComponent(
    value
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "-")
      .slice(0, 48)
  );
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
