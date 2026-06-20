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
    highlight(code, lang) {
      const language = lang && hljs.getLanguage(lang) ? lang : "plaintext";
      try {
        const result = hljs.highlight(code, { language, ignoreIllegals: true });
        return `<pre class="hljs"><code>${result.value}</code></pre>`;
      } catch {
        return `<pre class="hljs"><code>${escapeHtml(code)}</code></pre>`;
      }
    },
  });
  md.use(footnote);
  md.use(taskLists, { enabled: true });
  md.use(katexPlugin as never);

  // 微信适配：外链 a 标签转为脚注式（保留文字，去掉可点击外链）
  // 这里先保留，由 to-wechat.ts 的清洗步骤统一处理链接

  _md = md;
  return md;
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
