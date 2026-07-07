import matter from "front-matter";
import juice from "juice";
import { renderMarkdown } from "@/lib/markdown/renderer";
import { resolveCssVariables, readCodeThemeCss } from "@/lib/themes/loader";

/** 渲染所需的主题输入（与 to-wechat.ts 的 ConvertThemeInput 同构）。 */
export type RenderThemeInput = {
  cssContent: string;
  codeTheme: string;
  primaryColor: string;
};

export type RenderInlineResult = {
  /**
   * juice 全内联 HTML，包在 <div id="nice"> 内。
   * 仍含 4 段 <style>——是否清除交由渠道 finalize 决定（微信用 jsdom 删，
   * 通用导出用正则删），以保证各渠道进入后处理前的 HTML 完全一致。
   */
  html: string;
  /** 从 front-matter 提取的标题（无 fm 时为空串） */
  title: string;
};

/**
 * 通用 markdown 基础排版下限（#nice 容器 + 裸元素选择器，全渠道复用）。
 *
 * 历史上注释为「公众号基础排版下限」，但内容是标准 markdown 排版基线
 * （字号、行高、列表缩进、代码块圆角、表格边框等），对知乎/掘金/博客园
 * 等粘贴式渠道同样成立，故随通用渲染层迁移，不再绑定微信语义。
 */
export const BASE_CSS = `
#nice{font-size:16px;color:#2b2f36;line-height:1.86;letter-spacing:0.035em;word-break:break-word;text-align:left;}
#nice p{margin:0.82em 0;}
#nice a{color:#576b95;text-decoration:none;border-bottom:1px solid #576b95;}
#nice strong{font-weight:bold;}
#nice em{color:#606875;}
#nice hr{width:33.333%;border:none;border-top:1px solid #e5e7eb;margin:1.9em auto;}
#nice ul,#nice ol{padding-left:1.45em;margin:0.72em 0 0.9em;}
#nice li{margin:0.32em 0;line-height:1.78;}
#nice li>p{margin:0.1em 0;}
#nice .contains-task-list{padding-left:0;list-style:none;}
#nice .task-list-item{list-style:none;}
#nice .task-list-item-checkbox{margin:0 .45em .16em 0;vertical-align:middle;}
#nice blockquote{margin:1.1em 0;padding:0.95em 1.1em;border-left:4px solid #d1d5db;color:#606875;background:#f8fafc;}
#nice table{border-collapse:separate;border-spacing:0;width:100%;margin:1.05em 0;display:table;overflow:hidden;}
#nice th,#nice td{border-right:1px solid #e5e7eb;border-bottom:1px solid #e5e7eb;padding:0.65em 0.8em;text-align:left;}
#nice th{background:#f6f8fa;font-weight:600;}
#nice img{display:block;max-width:100%;height:auto;margin:1.05em auto;}
#nice sub,#nice sup{line-height:0;}
#nice .code-block{display:block;margin:1.05em 0;border-radius:10px;overflow:hidden;background:#0d1117;box-shadow:0 8px 24px rgba(15,23,42,.14);}
#nice .code__header{display:flex;align-items:center;justify-content:space-between;height:34px;padding:0 14px;background:#161b22;border-bottom:1px solid rgba(255,255,255,.08);}
#nice .code__dots{display:inline-block;line-height:0;}
#nice .code__dots i{display:inline-block;width:9px;height:9px;margin-right:6px;border-radius:50%;background:#ff5f57;}
#nice .code__dots i:nth-child(2){background:#febc2e;}
#nice .code__dots i:nth-child(3){background:#28c840;}
#nice .code__lang{font-size:10px;line-height:1;color:#8b949e;letter-spacing:.12em;font-weight:600;}
#nice pre{margin:0;padding:1.05em 1.2em 1.2em;border-radius:0;overflow-x:auto;font-size:13px;line-height:1.72;letter-spacing:0;}
#nice code{font-family:Menlo,Monaco,Consolas,monospace;}
#nice pre code{background:none;padding:0;}
#nice .codespan{padding:.15em .42em;border-radius:4px;font-size:.88em;letter-spacing:0;word-break:normal;overflow-wrap:anywhere;}
#nice .katex{font-size:1em;}
#nice .katex-display{margin:1.15em 0;overflow-x:auto;overflow-y:hidden;text-align:center;}
#nice .footnotes{margin-top:1.8em;padding-top:.9em;border-top:1px solid #e5e7eb;color:#6b7280;font-size:.86em;line-height:1.72;}
#nice .footnotes ol{margin:.4em 0 0;padding-left:1.35em;}
#nice .footnotes li{margin:.22em 0;color:#6b7280;}
#nice .footnote-ref,#nice .footnote-backref{border-bottom:0;color:#576b95;}
#nice .mermaid-preview{margin:1.2em 0;padding:.9em;border:1px solid #e5e7eb;border-radius:10px;background:#fff;text-align:center;overflow-x:auto;}
#nice .mermaid-preview svg{max-width:100%;height:auto;}
`;

/**
 * Markdown → 全内联 HTML（通用渠道前置，5 步）：
 * 1. 剥 front-matter
 * 2. markdown-it 渲染（含 hljs/katex/footnote/task-lists）
 * 3. 拼装 <div id="nice"> + 4 段 <style>（基础/主题/代码/字体）
 * 4. 解析 CSS 变量 var(--md-*)
 * 5. juice 全内联到 style 属性
 *
 * 刻意不做（交由渠道 finalize）：图片上传、删 <style> 残留、列表 section 化、
 * 首尾空 p 占位、锚点清理、img 尺寸内联。这些是平台差异点。
 *
 * 等价性说明：本函数产出与重构前 to-wechat.ts 步骤 3-6 逐字符一致（同样的
 * wrappedHtml + 同样的 juice 配置），保证微信路径 zero-regression。
 */
export async function renderInlineHtml(
  markdown: string,
  theme: RenderThemeInput
): Promise<RenderInlineResult> {
  // 1. 剥 front-matter
  const fm = matter<{ title?: string }>(markdown);
  const body = fm.body || markdown;
  const fmTitle =
    typeof fm.attributes?.title === "string" ? fm.attributes.title : "";

  // 2. markdown-it 渲染
  const innerHtml = renderMarkdown(body);

  // 3. 拼装 + 4. 解析变量
  const themeCss = resolveCssVariables(theme.cssContent, theme.primaryColor);
  const codeCss = await readCodeThemeCss(theme.codeTheme);
  const fontCss = `*{font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;}`;

  const wrappedHtml = `
    <div id="nice">
      <style id="basic-theme">${BASE_CSS}</style>
      <style id="markdown-theme">${themeCss}</style>
      <style id="code-theme">${codeCss}</style>
      <style id="font-theme">${fontCss}</style>
      ${innerHtml}
    </div>
  `;

  // 5. juice 全内联
  const html = juice(wrappedHtml, {
    inlinePseudoElements: true,
    preserveImportant: true,
    resolveCSSVariables: false,
  });

  return { html, title: fmTitle };
}
