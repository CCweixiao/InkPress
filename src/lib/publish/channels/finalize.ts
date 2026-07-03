import { finalizeForWeChat } from "@/lib/convert/to-wechat";
import {
  stripUnsafeTags,
  inlineImageDimensions,
} from "@/lib/convert/html-sanitize";
import type { ChannelFinalize } from "./types";

/**
 * 通用导出渠道的后处理：只做对所有富文本编辑器都安全的无害清洗。
 *
 * 删 juice 残留的 <style> 标签 + img 尺寸属性镜像到 style。
 * 刻意保留：原生 ul/ol/li、inline style、锚点、段落结构——这些在知乎/掘金/
 * 博客园都原生支持，无需也不应做微信式的 section 化改造。
 */
const finalizeForExport: ChannelFinalize = (html) =>
  inlineImageDimensions(stripUnsafeTags(html));

/**
 * 渠道 id → finalize 函数（服务端注册表）。
 *
 * ⚠️ 客户端组件禁止 import 本文件——它会拉入 to-wechat → render-inline →
 * prisma (better-sqlite3) 的 Node 原生依赖，导致浏览器 bundle 报 fs 错误。
 * 客户端需要的渠道元数据请 import from "@/lib/publish/channels/meta"。
 */
const FINALIZERS: Record<string, ChannelFinalize> = {
  wechat: finalizeForWeChat,
  zhihu: finalizeForExport,
  juejin: finalizeForExport,
  bokeyuan: finalizeForExport,
  generic: finalizeForExport,
};

/** 规范化渠道 id；未知 id 兜底 wechat（保证向后兼容）。 */
export function resolveFinalizeChannelId(id: string): string {
  return FINALIZERS[id] ? id : "wechat";
}

/** 按 id 取 finalize；未知 id 兜底 wechat（保证向后兼容）。 */
export function getFinalize(id: string): ChannelFinalize {
  return FINALIZERS[resolveFinalizeChannelId(id)];
}
