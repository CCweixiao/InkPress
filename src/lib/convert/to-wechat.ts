import matter from "front-matter";
import juice from "juice";
import { JSDOM } from "jsdom";
import { renderMarkdown } from "@/lib/markdown/renderer";
import {
  resolveCssVariables,
  readCodeThemeCss,
} from "@/lib/themes/loader";

export type ConvertThemeInput = {
  cssContent: string;
  codeTheme: string;
  primaryColor: string;
};

export type ConvertResult = {
  html: string; // 微信安全 HTML（全内联 style）
  title: string; // 从 front-matter 提取的标题（可选）
};

/** 微信公众号正文图片上传器（正文图必须走 uploadimg 换 wx_src） */
export type ImageUploader = (
  url: string
) => Promise<string | null>;

/**
 * Markdown → 公众号 inline HTML 全流水线（8 步）
 *
 * 1. 剥离 front-matter
 * 2. 图片 URL 预处理（外链 → wx_src）
 * 3. markdown-it 渲染（含 hljs/katex/footnote/task-lists）
 * 4. 拼装：<div id="nice"> + 4 段 <style>（基础/主题/代码/字体）
 * 5. 解析 CSS 变量 var(--md-*)
 * 6. juice 内联全部 CSS 到 style 属性
 * 7. 微信专项清洗（script/style 残留、锚点链接、嵌套列表、img 尺寸、首尾空 p）
 */
export async function convertToWeChat(
  markdown: string,
  theme: ConvertThemeInput,
  options: { uploadImage?: ImageUploader } = {}
): Promise<ConvertResult> {
  // 1. 剥 front-matter
  const fm = matter<{ title?: string }>(markdown);
  const body = fm.body || markdown;
  const fmTitle = typeof fm.attributes?.title === "string" ? fm.attributes.title : "";

  // 2. 图片 URL 预处理
  let processedMd = body;
  if (options.uploadImage) {
    processedMd = await replaceImageUrls(body, options.uploadImage);
  }

  // 3. markdown-it 渲染
  const innerHtml = renderMarkdown(processedMd);

  // 4. 拼装 + 5. 解析变量
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

  // 6. juice 内联
  const inlined = juice(wrappedHtml, {
    inlinePseudoElements: true,
    preserveImportant: true,
    resolveCSSVariables: false,
  });

  // 7. 微信专项清洗（基于 jsdom）
  const cleaned = cleanForWeChat(inlined);

  return { html: cleaned, title: fmTitle };
}

/** 提取所有 ![](url) 并替换为微信素材 URL */
async function replaceImageUrls(
  md: string,
  upload: ImageUploader
): Promise<string> {
  const pattern = /!\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  const matches = [...md.matchAll(pattern)];
  if (matches.length === 0) return md;

  // 去重，避免同一张图重复上传
  const urlMap = new Map<string, string>();
  for (const m of matches) {
    const original = m[1];
    if (urlMap.has(original)) continue;
    const wx = await upload(original).catch(() => null);
    if (wx) urlMap.set(original, wx);
  }

  return md.replace(pattern, (full, url: string) => {
    const wx = urlMap.get(url);
    return wx ? full.replace(url, wx) : full;
  });
}

/** 微信公众号基础排版下限样式（与 doocs base 类似） */
const BASE_CSS = `
#nice{font-size:16px;color:#3f3f3f;line-height:1.75;letter-spacing:0.05em;word-break:break-word;}
#nice p{margin:1.12em 0;}
#nice a{color:#576b95;text-decoration:none;border-bottom:1px solid #576b95;}
#nice strong{font-weight:bold;}
#nice hr{border:none;border-top:1px solid #ddd;margin:1.5em 0;}
#nice ul,#nice ol{padding-left:1.5em;margin:1em 0;}
#nice li{margin:0.3em 0;}
#nice blockquote{margin:1em 0;padding:0.5em 1em;border-left:3px solid #dfdfdf;color:#888;background:#fafafa;}
#nice table{border-collapse:collapse;width:100%;margin:1em 0;display:table;}
#nice th,#nice td{border:1px solid #ddd;padding:0.5em 0.75em;}
#nice th{background:#f5f5f5;}
#nice img{max-width:100%;}
#nice pre{padding:1em;border-radius:4px;overflow-x:auto;font-size:0.9em;line-height:1.5;}
#nice code{font-family:Menlo,Monaco,Consolas,monospace;}
#nice pre code{background:none;padding:0;}
`;

/** 微信专项清洗 */
function cleanForWeChat(html: string): string {
  const dom = new JSDOM(html);
  const doc = dom.window.document;
  const root = doc.getElementById("nice") ?? doc.body;

  // 删除残留 <script> / <style>
  root.querySelectorAll("script, style").forEach((el: Element) => el.remove());

  // 锚点链接去 href（公众号正文锚点无效）
  root.querySelectorAll("a").forEach((a: Element) => {
    const href = a.getAttribute("href") ?? "";
    if (href.startsWith("#")) {
      a.removeAttribute("href");
      a.removeAttribute("target");
    }
  });

  // img 的 width/height 属性 → 内联 style（公众号认 style 不认属性）
  root.querySelectorAll("img").forEach((img: Element) => {
    const w = img.getAttribute("width");
    const h = img.getAttribute("height");
    const existing = img.getAttribute("style") ?? "";
    const extra = [
      w ? `width:${w}px` : "",
      h ? `height:${h}px` : "",
    ]
      .filter(Boolean)
      .join(";");
    if (extra) img.setAttribute("style", `${existing};${extra}`.replace(/^;/, ""));
  });

  // 嵌套列表：<li> 内的 ul/ol 移到 li 之后（公众号渲染异常）
  root.querySelectorAll("li").forEach((li: Element) => {
    const nested = li.querySelectorAll(":scope > ul, :scope > ol");
    nested.forEach((list: Element) => {
      li.after(list);
    });
  });

  // 取出 root 的 innerHTML
  const cleaned = root.innerHTML;

  // 首尾各加一个空 p 占位（公众号编辑器首尾贴边）
  const placeholder =
    '<p style="font-size:0;line-height:0;margin:0;visibility:hidden;">&nbsp;</p>';
  return placeholder + cleaned + placeholder;
}
