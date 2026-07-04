import { NextRequest } from "next/server";
import { requireSession } from "@/lib/auth/session";
import {
  buildTicketObjectKey,
  putObject,
} from "@/lib/oss";
import {
  MAX_IMAGE_BYTES,
  MAX_IMAGES,
  ALLOWED_IMAGE_TYPES,
} from "@/lib/tickets/constants";
import { ok, fail, failFromError, getRequestId } from "@/lib/api-response";
import { ErrorCode } from "@/lib/errors";
import { moduleLogger } from "@/lib/logger";

const log = moduleLogger("upload-ticket-image");

const IMAGE_EXT_MAP: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

export async function POST(req: NextRequest) {
  const requestId = getRequestId(req.headers);
  try {
    const session = await requireSession();

    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return fail(ErrorCode.VALIDATION_ERROR, {
        message: "缺少 file 字段",
        requestId,
      });
    }

    // 服务端校验：类型
    if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
      return fail(ErrorCode.VALIDATION_ERROR, {
        message: "仅支持 JPEG/PNG/WebP/GIF 图片",
        requestId,
      });
    }
    // 服务端校验：大小
    if (file.size > MAX_IMAGE_BYTES) {
      return fail(ErrorCode.PAYLOAD_TOO_LARGE, {
        message: "图片不能超过 2MB",
        requestId,
      });
    }
    // 服务端校验：数量上限（通过 form 字段 attachmentsCount 传入已上传数）
    const existingCount = Number(form.get("count") ?? 0);
    if (existingCount >= MAX_IMAGES) {
      return fail(ErrorCode.VALIDATION_ERROR, {
        message: `最多上传 ${MAX_IMAGES} 张图片`,
        requestId,
      });
    }

    const buf = Buffer.from(await file.arrayBuffer());
    const ext = IMAGE_EXT_MAP[file.type] ?? "bin";
    const key = buildTicketObjectKey(session.user.id, ext);
    await putObject(key, buf, file.type);

    return ok(
      { key, name: file.name, size: file.size, contentType: file.type },
      { status: 201, requestId }
    );
  } catch (err) {
    log.error({ err, requestId }, "工单图片上传失败");
    return failFromError(err, requestId);
  }
}
