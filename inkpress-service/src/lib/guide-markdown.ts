type MarkdownToken =
  | { type: "html"; value: string }
  | { type: "blank" };

export function renderGuideMarkdown(markdown: string): string {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const tokens: MarkdownToken[] = [];
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
      const level = heading[1].length;
      const text = heading[2].trim();
      const id = `heading-${headingIndex++}-${slugify(text)}`;
      tokens.push({
        type: "html",
        value: `<h${level} id="${id}">${formatInline(text)}</h${level}>`,
      });
      i += 1;
      continue;
    }

    if (line.startsWith("> ")) {
      const quote: string[] = [];
      while (i < lines.length && lines[i].startsWith("> ")) {
        quote.push(lines[i].slice(2));
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

    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*]\s+/, ""));
        i += 1;
      }
      tokens.push({
        type: "html",
        value: `<ul>${items.map((item) => `<li>${formatInline(item)}</li>`).join("")}</ul>`,
      });
      continue;
    }

    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\.\s+/, ""));
        i += 1;
      }
      tokens.push({
        type: "html",
        value: `<ol>${items.map((item) => `<li>${formatInline(item)}</li>`).join("")}</ol>`,
      });
      continue;
    }

    const paragraph = [line.trim()];
    i += 1;
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^(#{1,4})\s+/.test(lines[i]) &&
      !/^```/.test(lines[i]) &&
      !/^\s*[-*]\s+/.test(lines[i]) &&
      !/^\s*\d+\.\s+/.test(lines[i]) &&
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

  return tokens
    .filter((token, index, all) => token.type !== "blank" || all[index - 1]?.type !== "blank")
    .map((token) => (token.type === "html" ? token.value : ""))
    .join("\n");
}

function formatInline(value: string): string {
  let html = escapeHtml(value);
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
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
