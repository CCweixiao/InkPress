import MarkdownIt from "markdown-it";
import footnote from "markdown-it-footnote";
import taskLists from "markdown-it-task-lists";
// katex 公式支持（@traptitech/markdown-it-katex 渲染为带 katex HTML 的内容）
// 动态 require 兼容其 CommonJS 导出
import katexPlugin from "@traptitech/markdown-it-katex";
import hljs from "highlight.js";

let _md: MarkdownIt | null = null;

/**
 * 服务端 markdown-it 单例
 * - 代码高亮用 highlight.js（输出带 hljs-* class 的 span，后续与 hljs CSS 一起 juice 内联）
 * - 启用 footnote / task-lists / katex
 */
export function getRenderer(): MarkdownIt {
  if (_md) return _md;
  const md = new MarkdownIt({
    html: false,
    linkify: true,
    breaks: false,
  });
  md.use(footnote);
  md.use(taskLists, { enabled: true });
  md.use(katexPlugin as never);

  md.renderer.rules.code_inline = (tokens, idx) =>
    `<code class="codespan">${escapeHtml(tokens[idx].content)}</code>`;

  md.renderer.rules.fence = (tokens, idx) => {
    const token = tokens[idx];
    const info = token.info.trim();
    const requestedLanguage = info.split(/\s+/)[0] || "text";
    const highlightLanguage = hljs.getLanguage(requestedLanguage)
      ? requestedLanguage
      : "plaintext";
    const languageClass = requestedLanguage || highlightLanguage;
    const languageLabel = getLanguageLabel(requestedLanguage);
    let highlighted = escapeHtml(token.content);

    try {
      highlighted = hljs.highlight(token.content, {
        language: highlightLanguage,
        ignoreIllegals: true,
      }).value;
    } catch {
      // 保留已转义的纯文本，代码内容始终可读。
    }

    return [
      '<section class="code-block">',
      '<div class="code__header">',
      '<span class="code__dots"><i></i><i></i><i></i></span>',
      `<span class="code__lang">${escapeHtml(languageLabel)}</span>`,
      "</div>",
      `<pre class="hljs code__pre"><code class="language-${escapeHtml(languageClass)}">${highlighted}</code></pre>`,
      "</section>\n",
    ].join("");
  };

  _md = md;
  return md;
}

const LANGUAGE_LABELS: Record<string, string> = {
  text: "TEXT",
  plaintext: "TEXT",
  shell: "SHELL",
  bash: "BASH",
  sh: "SHELL",
  js: "JAVASCRIPT",
  javascript: "JAVASCRIPT",
  ts: "TYPESCRIPT",
  typescript: "TYPESCRIPT",
  jsx: "JSX",
  tsx: "TSX",
  py: "PYTHON",
  python: "PYTHON",
  java: "JAVA",
  go: "GO",
  rust: "RUST",
  sql: "SQL",
  json: "JSON",
  yaml: "YAML",
  yml: "YAML",
  html: "HTML",
  css: "CSS",
  xml: "XML",
  markdown: "MARKDOWN",
  md: "MARKDOWN",
};

function getLanguageLabel(language: string): string {
  return LANGUAGE_LABELS[language.toLowerCase()] ?? language.toUpperCase();
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** 渲染 markdown → 带 class 的 HTML（不含主题 CSS / 未内联） */
export function renderMarkdown(mdText: string): string {
  return getRenderer().render(mdText || "");
}
