/**
 * 按 kind 把素材映射成插入编辑器的 Markdown（对齐设计文档 §5.4）。
 * 纯函数，不依赖 React / editor —— 面板点击与 SnippetDrop 插件共用，便于单测。
 */
export type SnippetLike = {
  kind: string;
  content: string;
  title?: string;
  imageUrl?: string | null;
  quoteSource?: string | null;
  linkUrl?: string | null;
  linkTitle?: string | null;
};

export function snippetToMarkdown(s: SnippetLike): string {
  switch (s.kind) {
    case "quote": {
      return s.quoteSource
        ? `> "${s.content}"\n>\n> —— ${s.quoteSource}`
        : `> "${s.content}"`;
    }
    case "image": {
      const alt = s.title || "图";
      const img = s.imageUrl ? `![${alt}](${s.imageUrl})` : "";
      return s.content ? `${img}\n${s.content}` : img;
    }
    case "link": {
      const url = s.linkUrl || "";
      const text = s.linkTitle || url;
      const link = url ? `[${text}](${url})` : text;
      return s.content ? `${link} — ${s.content}` : link;
    }
    case "text":
    default:
      return s.content;
  }
}
