/**
 * 渠道注册表服务端便利入口（re-export 元数据 + finalize）。
 *
 * ⚠️ 客户端组件请直接 import from "./meta"，勿 import 本文件——
 * 本文件 re-export 的 finalize 链依赖 to-wechat → render-inline → prisma
 * (better-sqlite3)，会拉入 Node 原生模块，无法在浏览器运行。
 *
 * 服务端 API route 可自由 import 本文件。
 */
export { CHANNELS, getChannelMeta, allChannelMeta } from "./meta";
export type {
  ChannelMeta,
  ChannelKind,
  ChannelFinalize,
  CredentialRequirement,
} from "./types";
export { getFinalize } from "./finalize";
