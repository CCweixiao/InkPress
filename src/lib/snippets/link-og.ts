import { JSDOM } from "jsdom";
import { assertSafePublicUrl } from "@/lib/ai/safe-web";
import { prisma } from "@/lib/db";
import { moduleLogger } from "@/lib/logger";

const log = moduleLogger("snippets.link-og");

const OG_TIMEOUT_MS = 10000;
const OG_MAX_HTML = 1024 * 1024; // 1MB
const OG_MAX_REDIRECTS = 5;

export type OgMeta = { title?: string; description?: string; image?: string };

/** 按 selectors 顺序读第一个非空 meta content。 */
function readMeta(doc: Document, selectors: string[]): string | undefined {
  for (const sel of selectors) {
    const el = doc.querySelector(sel);
    const content = el?.getAttribute("content");
    if (content && content.trim()) return content.trim();
  }
  return undefined;
}

/**
 * 纯函数：从 HTML 抽 OG 元数据。
 * 优先级：og:* → twitter:* → <title>/<meta name="description"> 兜底。
 * image 返回原始 content（相对路径由 fetchOgMetadata 用 finalUrl 补全）。
 * 空/非 html/jsdom 抛错 → 返 {}。
 */
export function parseOgHtml(html: string): OgMeta {
  if (!html || !html.trim()) return {};
  let doc: Document;
  try {
    doc = new JSDOM(html, { url: "about:blank" }).window.document;
  } catch {
    return {};
  }
  const ogTitle = readMeta(doc, [
    'meta[property="og:title"]',
    'meta[name="twitter:title"]',
  ]);
  const title =
    ogTitle ??
    (doc.querySelector("title")?.textContent?.trim() || undefined);
  const description = readMeta(doc, [
    'meta[property="og:description"]',
    'meta[name="twitter:description"]',
    'meta[name="description"]',
  ]);
  const image = readMeta(doc, [
    'meta[property="og:image"]',
    'meta[name="twitter:image"]',
  ]);
  const out: OgMeta = {};
  if (title) out.title = title;
  if (description) out.description = description;
  if (image) out.image = image;
  return out;
}

/**
 * SSRF-safe HTML 抓取：assertSafePublicUrl 每跳重校验 + 手动重定向 + timeout + size cap。
 * 返回 { html, finalUrl } 或 null（非 html / 不 ok / 重定向过多 / 超时）。
 * assertSafePublicUrl 抛错向上传播（由 fetchOgMetadata 吞）。
 */
async function fetchHtmlSafe(
  startUrl: string
): Promise<{ html: string; finalUrl: string } | null> {
  let url = await assertSafePublicUrl(startUrl);
  for (let i = 0; i < OG_MAX_REDIRECTS; i++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), OG_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(url, {
        headers: {
          "User-Agent": "InkPress/1.0 LinkPreview",
          Accept: "text/html,application/xhtml+xml,*/*;q=0.8",
        },
        redirect: "manual",
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) return null;
      url = await assertSafePublicUrl(new URL(loc, url).toString());
      continue;
    }
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") ?? "";
    if (!/text\/html|application\/xhtml/i.test(ct)) return null;
    const html = (await res.text()).slice(0, OG_MAX_HTML);
    return { html, finalUrl: url };
  }
  return null;
}

/** 抓取并解析 OG 元数据。相对 image 用 finalUrl 补全为绝对 URL。全量吞错返 null。 */
export async function fetchOgMetadata(url: string): Promise<OgMeta | null> {
  try {
    const fetched = await fetchHtmlSafe(url);
    if (!fetched) return null;
    const meta = parseOgHtml(fetched.html);
    if (meta.image) {
      try {
        meta.image = new URL(meta.image, fetched.finalUrl).toString();
      } catch {
        /* 补全失败保留原值 */
      }
    }
    return meta;
  } catch (e) {
    log.warn({ err: e, url }, "fetchOgMetadata 失败");
    return null;
  }
}

/**
 * 加载 → fetchOgMetadata → 按 force 策略写回 linkTitle/Description/Image。
 * 非 link 或无 linkUrl → 直接返回。全量吞错，不阻断创建/编辑。
 */
export async function generateAndSaveOg(
  snippetId: string,
  opts?: { force?: boolean }
): Promise<void> {
  try {
    const s = await prisma.snippet.findUnique({ where: { id: snippetId } });
    if (!s || s.kind !== "link" || !s.linkUrl) return;
    const meta = await fetchOgMetadata(s.linkUrl);
    if (!meta) return;
    const force = opts?.force === true;
    const data: {
      linkTitle?: string;
      linkDescription?: string;
      linkImage?: string;
    } = {};
    if (meta.title && (force || !s.linkTitle)) data.linkTitle = meta.title;
    if (meta.description && (force || !s.linkDescription))
      data.linkDescription = meta.description;
    if (meta.image && (force || !s.linkImage)) data.linkImage = meta.image;
    if (Object.keys(data).length === 0) return;
    await prisma.snippet.update({ where: { id: snippetId }, data });
  } catch (e) {
    log.warn({ err: e, snippetId }, "generateAndSaveOg 失败（不阻断）");
  }
}
