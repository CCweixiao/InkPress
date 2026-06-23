import matter from "front-matter";
import juice from "juice";
import { JSDOM } from "jsdom";
import { renderMarkdown } from "@/lib/markdown/renderer";
import {
  resolveCssVariables,
  readCodeThemeCss,
} from "@/lib/themes/loader";
import { moduleLogger } from "@/lib/logger";

const log = moduleLogger("convert.wechat");

export type ConvertThemeInput = {
  cssContent: string;
  codeTheme: string;
  primaryColor: string;
};

/** 单张图片上传失败的记录（url + 原因），供上层向用户回显 */
export type FailedImage = {
  url: string;
  reason: string;
};

export type ConvertResult = {
  html: string; // 微信安全 HTML（全内联 style）
  title: string; // 从 front-matter 提取的标题（可选）
  failedImages: FailedImage[]; // 上传失败的图片（已跳过替换，原外链保留 → 公众号会因防盗链裂图）
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
 * 7. 微信专项清洗（script/style 残留、锚点链接、列表兼容、img 尺寸、首尾空 p）
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

  // 2. 图片 URL 预处理（外链 → wx_src，失败保留原 URL 并记录）
  let processedMd = body;
  let failedImages: FailedImage[] = [];
  if (options.uploadImage) {
    const r = await replaceImageUrls(body, options.uploadImage);
    processedMd = r.md;
    failedImages = r.failed;
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
  const cleaned = cleanForWeChat(inlined, theme.primaryColor);

  return { html: cleaned, title: fmTitle, failedImages };
}

/**
 * 提取所有 ![](url) 并替换为微信素材 URL（并发上传，带限流）。
 *
 * 返回替换后的 markdown + 失败列表。失败 URL 原样保留在 markdown 中
 * （公众号会因防盗链裂图），上层据此向用户提示哪些图需要修复。
 *
 * 本地伪协议（blob:/data:）无法在服务端下载，直接记为失败跳过上传，
 * 避免无意义的 fetch 报错噪声。
 */
async function replaceImageUrls(
  md: string,
  upload: ImageUploader
): Promise<{ md: string; failed: FailedImage[] }> {
  const pattern = /!\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  const matches = [...md.matchAll(pattern)];
  if (matches.length === 0) return { md, failed: [] };

  // 去重 URL
  const uniqueUrls = [...new Set(matches.map((m) => m[1]))];

  // 并发上传（最多 3 个同时），避免长文几十张图串行等待
  const CONCURRENCY = 3;
  const urlMap = new Map<string, string>();
  const failed: FailedImage[] = [];
  for (let i = 0; i < uniqueUrls.length; i += CONCURRENCY) {
    const batch = uniqueUrls.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      batch.map(async (url) => {
        // 本地伪协议：服务端无法下载，注定失败，跳过上传
        if (/^(blob:|data:)/i.test(url)) {
          const reason = "本地占位 URL（blob/data），请重新插入图片";
          log.warn({ url, reason }, "跳过不可下载的本地图片");
          return [url, null, reason] as const;
        }
        // 失败原因透传：upload 内部已记录详细日志，这里只收口
        const wx = await upload(url).catch((e) => {
          const reason = e instanceof Error ? e.message : "上传失败";
          log.warn({ url, reason }, "正文图上传失败，原外链保留");
          return null;
        });
        return [url, wx, ""] as const;
      })
    );
    for (const [url, wx, reason] of results) {
      if (wx) {
        urlMap.set(url, wx);
      } else {
        failed.push({ url, reason: reason || "上传失败" });
      }
    }
  }

  if (failed.length > 0) {
    log.warn(
      { total: uniqueUrls.length, failed: failed.length, urls: failed.map((f) => f.url) },
      "部分正文图片上传失败，将以原外链推送（公众号可能因防盗链裂图）"
    );
  }

  const replaced = md.replace(pattern, (full, url: string) => {
    const wx = urlMap.get(url);
    return wx ? full.replace(url, wx) : full;
  });
  return { md: replaced, failed };
}

/** 微信公众号基础排版下限样式（与 doocs base 类似） */
const BASE_CSS = `
#nice{font-size:16px;color:#2b2f36;line-height:1.82;letter-spacing:0.035em;word-break:break-word;text-align:left;}
#nice p{margin:0.75em 0;}
#nice a{color:#576b95;text-decoration:none;border-bottom:1px solid #576b95;}
#nice strong{font-weight:bold;}
#nice hr{border:none;border-top:1px solid #e5e7eb;margin:1.5em 0;}
#nice ul,#nice ol{padding-left:1.4em;margin:0.6em 0;}
#nice li{margin:0.26em 0;line-height:1.75;}
#nice li>p{margin:0.1em 0;}
#nice blockquote{margin:1em 0;padding:0.9em 1.1em;border-left:4px solid #d1d5db;color:#606875;background:#f8fafc;}
#nice table{border-collapse:separate;border-spacing:0;width:100%;margin:1.05em 0;display:table;overflow:hidden;}
#nice th,#nice td{border-right:1px solid #e5e7eb;border-bottom:1px solid #e5e7eb;padding:0.65em 0.8em;text-align:left;}
#nice th{background:#f6f8fa;font-weight:600;}
#nice img{display:block;max-width:100%;height:auto;margin:1.05em auto;}
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
#nice .codespan{padding:.15em .42em;border-radius:4px;font-size:.88em;letter-spacing:0;word-break:break-all;}
`;

/** 微信专项清洗 */
function cleanForWeChat(html: string, primaryColor: string): string {
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

  // 微信会重写 ul / ol / li，原生 marker 在嵌套列表、松散列表中很容易变成
  // 独立空圆点。发布前改为纯 section + 文本 marker，不再依赖平台列表样式。
  normalizeListsForWeChat(root, primaryColor);

  // 取出 root 的 innerHTML
  const cleaned = root.innerHTML;

  // 首尾各加一个空 p 占位（公众号编辑器首尾贴边）
  const placeholder =
    '<p style="font-size:0;line-height:0;margin:0;visibility:hidden;">&nbsp;</p>';
  return placeholder + cleaned + placeholder;
}

/**
 * 把语义列表转换为微信稳定结构。
 *
 * Markdown:
 *   - **标题**：说明
 *
 * 输出:
 *   <section data-wx-list="ul">
 *     <section data-wx-list-item="true">
 *       <span>•</span><strong>标题</strong>：说明
 *     </section>
 *   </section>
 *
 * 使用 padding-left + text-indent 实现悬挂缩进，只依赖微信长期支持的基础样式。
 * 逆序处理可先完成子列表；只有子列表、没有正文的父 li 会被直接跳过，
 * 避免出现截图中的空圆点。
 */
function normalizeListsForWeChat(root: Element, primaryColor: string): void {
  const lists = Array.from(root.querySelectorAll("ul, ol")).reverse();

  for (const list of lists) {
    const doc = list.ownerDocument;
    const ordered = list.tagName.toLowerCase() === "ol";
    const start = ordered
      ? Number.parseInt(list.getAttribute("start") || "1", 10) || 1
      : 1;
    const depth = getListDepth(list);
    const wrapper = doc.createElement("section");
    wrapper.setAttribute("data-wx-list", ordered ? "ol" : "ul");
    wrapper.setAttribute("data-wx-list-depth", String(depth));
    applyListWrapperStyle(wrapper, depth);

    const items = Array.from(list.children).filter(
      (child) => child.tagName.toLowerCase() === "li"
    );
    let visibleIndex = 0;

    for (const item of items) {
      const nestedLists = Array.from(
        item.querySelectorAll(":scope > section[data-wx-list]")
      );
      const checkbox = item.querySelector(
        ":scope > input[type='checkbox'], :scope > p > input[type='checkbox']"
      ) as HTMLInputElement | null;
      const ownText = getOwnListItemText(item, checkbox);

      // Tiptap / AI 可能生成空父项包裹子列表。不要为这种父项输出 marker。
      if (!ownText && nestedLists.length > 0) {
        nestedLists.forEach((nested) => wrapper.appendChild(nested));
        continue;
      }
      if (!ownText && !checkbox) continue;

      const marker = checkbox
        ? checkbox.checked
          ? "☑"
          : "☐"
        : ordered
          ? `${start + visibleIndex}.`
          : getBullet(depth);
      visibleIndex += 1;
      checkbox?.remove();

      const row = doc.createElement("section");
      row.setAttribute("data-wx-list-item", "true");
      row.setAttribute(
        "style",
        [
          "display:block",
          "margin:0.42em 0",
          `padding-left:${ordered ? "1.8em" : "1.45em"}`,
          `text-indent:-${ordered ? "1.8em" : "1.45em"}`,
          "line-height:1.78",
          "text-align:left",
        ].join(";")
      );

      const markerNode = doc.createElement("span");
      markerNode.setAttribute("data-wx-list-marker", "true");
      markerNode.setAttribute(
        "style",
        [
          "display:inline-block",
          `min-width:${ordered ? "1.8em" : "1.45em"}`,
          "text-indent:0",
          `color:${primaryColor}`,
          "font-weight:600",
        ].join(";")
      );
      markerNode.textContent = marker;
      row.appendChild(markerNode);

      appendListItemContent(row, item, nestedLists);
      wrapper.appendChild(row);
    }

    const directItems = Array.from(wrapper.children).filter(
      (child) => child.hasAttribute("data-wx-list-item")
    );
    const directNestedLists = Array.from(wrapper.children).filter(
      (child) => child.hasAttribute("data-wx-list")
    );

    // 整层都只是空壳时，直接提升子列表一级，不保留多余缩进和空容器。
    if (directItems.length === 0 && directNestedLists.length > 0) {
      const fragment = doc.createDocumentFragment();
      directNestedLists.forEach((nested) => {
        promoteList(nested);
        fragment.appendChild(nested);
      });
      list.replaceWith(fragment);
    } else {
      list.replaceWith(wrapper);
    }
  }

  root
    .querySelectorAll("[data-wx-list-depth]")
    .forEach((list) => list.removeAttribute("data-wx-list-depth"));
}

function getListDepth(list: Element): number {
  let depth = 0;
  let parent = list.parentElement;
  while (parent) {
    if (parent.tagName === "UL" || parent.tagName === "OL") depth += 1;
    parent = parent.parentElement;
  }
  return depth;
}

function getBullet(depth: number): string {
  if (depth % 3 === 1) return "◦";
  if (depth % 3 === 2) return "▪";
  return "•";
}

function getOwnListItemText(
  item: Element,
  checkbox: HTMLInputElement | null
): string {
  const clone = item.cloneNode(true) as Element;
  clone
    .querySelectorAll(":scope > section[data-wx-list]")
    .forEach((nested) => nested.remove());
  clone
    .querySelectorAll("input[type='checkbox']")
    .forEach((input) => input.remove());
  if (checkbox && !clone.textContent?.trim()) return "";
  return clone.textContent?.replace(/\u00a0/g, " ").trim() ?? "";
}

function applyListWrapperStyle(wrapper: Element, depth: number): void {
  wrapper.setAttribute(
    "style",
    [
      "display:block",
      `margin:${depth > 0 ? "0.28em 0 0.2em 0.55em" : "0.8em 0"}`,
      "padding:0",
      "text-indent:0",
    ].join(";")
  );
}

function promoteList(list: Element): void {
  const currentDepth = Number.parseInt(
    list.getAttribute("data-wx-list-depth") || "0",
    10
  );
  const nextDepth = Math.max(0, currentDepth - 1);
  list.setAttribute("data-wx-list-depth", String(nextDepth));
  applyListWrapperStyle(list, nextDepth);

  if (list.getAttribute("data-wx-list") === "ul") {
    Array.from(list.children)
      .filter((child) => child.hasAttribute("data-wx-list-item"))
      .forEach((item) => {
        item
          .querySelector(":scope > span[data-wx-list-marker]")
          ?.replaceChildren(getBullet(nextDepth));
      });
  }

  Array.from(list.children)
    .filter((child) => child.hasAttribute("data-wx-list"))
    .forEach((nested) => promoteList(nested));
}

function appendListItemContent(
  row: Element,
  item: Element,
  nestedLists: Element[]
): void {
  const doc = row.ownerDocument;
  const nestedSet = new Set(nestedLists);
  let paragraphIndex = 0;

  for (const node of Array.from(item.childNodes)) {
    if (node.nodeType === 3) {
      if (node.textContent?.trim()) row.appendChild(node);
      continue;
    }
    if (!(node instanceof doc.defaultView!.Element)) continue;
    if (nestedSet.has(node)) continue;
    if (
      node.tagName.toLowerCase() === "input" &&
      node.getAttribute("type") === "checkbox"
    ) {
      continue;
    }

    if (node.tagName.toLowerCase() === "p") {
      const children = Array.from(node.childNodes).filter(
        (child) =>
          !(
            child instanceof doc.defaultView!.Element &&
            child.tagName.toLowerCase() === "input" &&
            child.getAttribute("type") === "checkbox"
          )
      );
      if (paragraphIndex === 0 || startsWithJoinPunctuation(node.textContent)) {
        children.forEach((child) => row.appendChild(child));
      } else {
        const paragraph = doc.createElement("section");
        paragraph.setAttribute(
          "style",
          "display:block;margin:0.35em 0 0;padding:0;text-indent:0;line-height:1.78"
        );
        children.forEach((child) => paragraph.appendChild(child));
        row.appendChild(paragraph);
      }
      paragraphIndex += 1;
      continue;
    }

    row.appendChild(node);
  }

  nestedLists.forEach((nested) => row.appendChild(nested));
}

function startsWithJoinPunctuation(text: string | null): boolean {
  return /^[：:，,；;、]/.test(text?.trim() ?? "");
}
