import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { AppError, ErrorCode, HTTP_STATUS } from "@/lib/errors";

/** 统一成功响应（PDC §7） */
export type ApiSuccess<T> = {
  ok: true;
  data: T;
  requestId: string;
};

/** 统一错误响应（PDC §7） */
export type ApiErrorBody = {
  ok: false;
  error: { code: string; message: string; details?: unknown };
  requestId: string;
};

/** 生成或复用 requestId（优先读取 X-Request-Id 头） */
export function getRequestId(headers?: Headers): string {
  const fromHeader = headers?.get("x-request-id");
  if (fromHeader && /^[A-Za-z0-9-]{8,64}$/.test(fromHeader)) return fromHeader;
  return randomUUID();
}

export function ok<T>(
  data: T,
  init?: { status?: number; requestId?: string; headers?: HeadersInit }
): NextResponse<ApiSuccess<T>> {
  const requestId = init?.requestId ?? randomUUID();
  return NextResponse.json<ApiSuccess<T>>(
    { ok: true, data, requestId },
    { status: init?.status ?? 200, headers: init?.headers }
  );
}

export function fail(
  code: ErrorCode,
  options?: {
    message?: string;
    details?: unknown;
    requestId?: string;
    headers?: HeadersInit;
  }
): NextResponse<ApiErrorBody> {
  const status = HTTP_STATUS[code];
  const requestId = options?.requestId ?? randomUUID();
  const error: ApiErrorBody["error"] = {
    code,
    message: options?.message ?? code,
  };
  if (options?.details !== undefined) error.details = options.details;
  return NextResponse.json<ApiErrorBody>(
    { ok: false, error, requestId },
    { status, headers: options?.headers }
  );
}

/** 把未知异常转为统一错误响应，业务错误用其 code/状态，其余 500。 */
export function failFromError(
  err: unknown,
  requestId?: string
): NextResponse<ApiErrorBody> {
  if (err instanceof AppError) {
    return fail(err.code, { message: err.message, details: err.details, requestId });
  }
  return fail(ErrorCode.INTERNAL_ERROR, { message: "内部错误", requestId });
}
