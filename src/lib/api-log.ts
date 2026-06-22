import type { NextRequest, NextResponse } from "next/server";
import { moduleLogger } from "@/lib/logger";

/**
 * API 访问日志：包裹 route handler，自动记录 method/route/status/durationMs。
 *
 * 为什么不用 middleware：Next.js middleware 仅支持 Edge runtime，
 * 无法 import pino（依赖 node:fs），故改用 HOF 在 nodejs runtime 的 route 内记录。
 *
 * 日志级别：2xx/3xx → debug，4xx → warn，5xx → error。
 *
 * 用法：
 *   export const POST = withApiLog("POST /api/articles", async (req) => { ... });
 *   export const PUT = withApiLog("PUT /api/articles/[id]", async (req, { params }) => { ... });
 */
const log = moduleLogger("api");

/* eslint-disable @typescript-eslint/no-explicit-any */
type RouteHandler = (req: any, ...rest: any[]) => Promise<any> | any;

export function withApiLog(route: string, handler: RouteHandler): RouteHandler {
  return async (req: any, ...rest: any[]) => {
    const method: string = req?.method ?? "?";
    const start = Date.now();
    try {
      const res = await handler(req, ...rest);
      const durationMs = Date.now() - start;
      const status: number = res?.status ?? 200;
      const level = status >= 500 ? "error" : status >= 400 ? "warn" : "debug";
      log[level](
        { method, route, status, durationMs },
        `${method} ${route} → ${status}`
      );
      return res;
    } catch (err) {
      const durationMs = Date.now() - start;
      log.error(
        { method, route, status: 500, durationMs, err },
        `${method} ${route} 未捕获异常`
      );
      throw err;
    }
  };
}

/**
 * 记录关键数据操作（创建/更新/删除）。
 * 约定：module 标识业务域，action 为动词，id 为操作对象。
 */
export function logMutation(
  module: string,
  action: string,
  detail?: Record<string, unknown>
) {
  log.info({ module, action, ...detail }, `${module}.${action}`);
}
/* eslint-enable @typescript-eslint/no-explicit-any */
