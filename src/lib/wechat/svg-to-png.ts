/**
 * SVG → PNG 转换：微信公众号素材库不支持 SVG，上传前需转为 PNG。
 *
 * 选型：@resvg/resvg-js（napi-rs 构建，N-API 稳定 ABI）
 * - 对 Mermaid 的 CSS / foreignObject 兼容性优于 sharp 的 librsvg
 * - Node 22 + Electron 42 + ELECTRON_RUN_AS_NODE=1 下原生 .node 文件可直接加载
 *   （与 better-sqlite3 不同，后者用 NAN 受 V8 ABI 影响，resvg-js 用 N-API 不受影响）
 *
 * 双层防御：
 * - 第一层（OSS 落库时）：/api/upload、/api/upload/chunk 用户可控开关
 * - 第二层（公众号上传兜底）：4 个 WX 上传入口统一走 ensureWechatCompatibleImage
 */
import { moduleLogger } from "@/lib/logger";
import { JSDOM } from "jsdom";

const log = moduleLogger("wechat.svg-to-png");

const SVG_MIME = /^image\/svg(\+xml)?$/i;
const SVG_EXT = /\.svgz?$/i;

/** 判断是否为 SVG。兼容 image/svg+xml / image/svg / .svg / .svgz 后缀，大小写不敏感 */
export function isSvg(
  contentType?: string | null,
  filename?: string | null
): boolean {
  if (contentType && SVG_MIME.test(contentType)) return true;
  if (filename && SVG_EXT.test(filename)) return true;
  return false;
}

export type ConvertSvgOptions = {
  /** 输出 PNG 宽度上限（按比例缩放，默认 1920） */
  width?: number;
};

/**
 * 把 SVG buffer 渲染成 PNG buffer。
 *
 * 配置说明：
 * - fitTo.width=1920：公众号正文显示足够清晰，避免超大 PNG
 * - background=#ffffff：SVG 透明背景在微信编辑器会渲染成黑色，需铺白底
 * - font.loadSystemFonts：自动加载系统字体
 *   macOS PingFang SC / Windows 微软雅黑 / Linux Noto Sans CJK
 *
 * 错误会归类为友好提示（字体缺失 / SVG 格式有误 / 其他），
 * 原始堆栈用 pino 记录便于排查。
 */
export async function convertSvgToPng(
  svgBuffer: Buffer,
  options?: ConvertSvgOptions
): Promise<Buffer> {
  const width = options?.width ?? 1920;
  let mod: typeof import("@resvg/resvg-js");
  try {
    mod = await import("@resvg/resvg-js");
  } catch (e) {
    log.error({ err: e instanceof Error ? e.stack : String(e) }, "加载 @resvg/resvg-js 失败");
    throw new Error("SVG 转 PNG 失败：渲染引擎未正确安装，请重启应用或重新安装。");
  }

  const { Resvg } = mod;
  const svgText = normalizeSvgForWechatPng(svgBuffer.toString("utf8"));
  const preview = svgText.slice(0, 100);

  try {
    const resvg = new Resvg(svgText, {
      fitTo: { mode: "width", value: width },
      background: "#ffffff",
      font: {
        loadSystemFonts: true,
        defaultFontFamily: "sans-serif",
      },
    });
    const rendered = resvg.render();
    return rendered.asPng();
  } catch (e) {
    const raw = e instanceof Error ? e.message : String(e);
    log.error(
      { err: e instanceof Error ? e.stack : raw, preview },
      "SVG 渲染为 PNG 失败"
    );
    const kind = classifySvgError(raw);
    throw new Error(`SVG 转 PNG 失败：${kind}（SVG 前 100 字符：${preview}）`);
  }
}

/**
 * Mermaid 默认的 flowchart htmlLabels 会生成 <foreignObject> 承载节点文字。
 * 本地浏览器能正常显示，但微信公众号编辑器和部分 SVG→PNG 渲染器会丢弃这段 HTML，
 * 结果就是“框和连线在，文字为空”。发布前把 foreignObject 里的纯文本降级成
 * 原生 SVG <text>，让最终 PNG/微信正文都能稳定显示标签。
 */
export function normalizeSvgForWechatPng(svgText: string): string {
  const xmlSafeSvgText = xmlSafeSvg(svgText);
  if (!/<foreignObject[\s>]/i.test(xmlSafeSvgText)) return xmlSafeSvgText;

  try {
    const dom = new JSDOM(xmlSafeSvgText, { contentType: "image/svg+xml" });
    const doc = dom.window.document;
    const svgNamespace = "http://www.w3.org/2000/svg";
    const foreignObjects = Array.from(doc.querySelectorAll("foreignObject"));

    for (const foreignObject of foreignObjects) {
      const label = (foreignObject.textContent ?? "").replace(/\s+/g, " ").trim();
      if (!label) {
        foreignObject.remove();
        continue;
      }

      const x = numberAttr(foreignObject, "x");
      const y = numberAttr(foreignObject, "y");
      const width = numberAttr(foreignObject, "width");
      const height = numberAttr(foreignObject, "height");
      const text = doc.createElementNS(svgNamespace, "text");
      text.setAttribute("x", String(x + width / 2));
      text.setAttribute("y", String(y + height / 2));
      text.setAttribute("text-anchor", "middle");
      text.setAttribute("dominant-baseline", "middle");
      text.setAttribute("font-family", "-apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', sans-serif");
      text.setAttribute("font-size", "16");
      text.setAttribute("fill", "#333333");
      text.setAttribute("style", "white-space:pre;pointer-events:none");
      text.textContent = label;
      foreignObject.replaceWith(text);
    }

    return new dom.window.XMLSerializer().serializeToString(doc.documentElement);
  } catch (error) {
    log.warn(
      { err: error instanceof Error ? error.message : String(error) },
      "SVG foreignObject 文本降级失败，保留原 SVG"
    );
    return svgText;
  }
}

function xmlSafeSvg(svgText: string): string {
  return svgText.replace(/<(br|hr|img|input|meta|link)([^>]*?)(?<!\/)>/gi, "<$1$2/>");
}

function numberAttr(element: Element, name: string): number {
  const raw = element.getAttribute(name) ?? "0";
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) ? value : 0;
}

function classifySvgError(msg: string): string {
  const lower = msg.toLowerCase();
  if (lower.includes("font") || lower.includes("glyph") || lower.includes("typeface")) {
    return "字体缺失或加载失败";
  }
  if (
    lower.includes("parse") ||
    lower.includes("invalid") ||
    lower.includes("syntax") ||
    lower.includes("malformed")
  ) {
    return "SVG 格式有误";
  }
  return "渲染失败";
}

export type EnsureWechatCompatibleResult = {
  buf: ArrayBuffer;
  contentType: string;
  filename: string;
  /** 是否触发了 SVG → PNG 转换 */
  converted: boolean;
};

/** 把 ArrayBuffer/Buffer 归一化为一个独立的 ArrayBuffer（Blob 可直接消费） */
function toArrayBuffer(src: ArrayBuffer | Buffer): ArrayBuffer {
  if (Buffer.isBuffer(src)) {
    // 复制到独立的 ArrayBuffer（避免 byteOffset 偏移与 SharedArrayBuffer 类型问题）
    const copy = new Uint8Array(src.byteLength);
    copy.set(src);
    return copy.buffer;
  }
  return src;
}

/**
 * 确保图片对微信公众号素材库兼容：SVG 自动转 PNG，其余原样返回。
 *
 * 4 个公众号上传入口共用此兜底：
 * - uploadBodyImage / uploadCoverImage（material.ts）
 * - syncAssetToWechat（asset-sync.ts）
 * - /api/wechat/upload-material
 *
 * 转换后：contentType 改为 image/png，filename 后缀改为 .png。
 * 返回 ArrayBuffer 便于直接构造 Blob（公众号上传 form）。
 */
export async function ensureWechatCompatibleImage(params: {
  buf: ArrayBuffer | Buffer;
  contentType?: string | null;
  filename?: string | null;
}): Promise<EnsureWechatCompatibleResult> {
  if (!isSvg(params.contentType, params.filename)) {
    return {
      buf: toArrayBuffer(params.buf),
      contentType: params.contentType ?? "application/octet-stream",
      filename: params.filename ?? "image",
      converted: false,
    };
  }

  const inputBuf = Buffer.isBuffer(params.buf)
    ? params.buf
    : Buffer.from(params.buf);
  const pngBuf = await convertSvgToPng(inputBuf);
  const originalName = params.filename ?? "image.svg";
  const pngName = originalName.replace(/\.svgz?$/i, ".png");
  log.info(
    { from: params.contentType, filename: params.filename, size: pngBuf.byteLength },
    "SVG → PNG 转换完成（公众号兜底）"
  );
  return {
    buf: toArrayBuffer(pngBuf),
    contentType: "image/png",
    filename: pngName,
    converted: true,
  };
}
