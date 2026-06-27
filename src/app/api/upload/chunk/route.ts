import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/db";
import { classifyByContentType } from "@/lib/oss";
import { genAssetName, splitTagInput, tagsToJson } from "@/lib/asset";
import { syncAssetToWechat } from "@/lib/wechat/asset-sync";
import { cacheDir } from "@/lib/paths";
import { withApiLog, logMutation } from "@/lib/api-log";
import { moduleLogger } from "@/lib/logger";
import { originalFilenameMetadata, putFileObject } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const log = moduleLogger("upload.chunk");

const TMP_ROOT = cacheDir();
const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB
const CHUNK_SIZE_DEFAULT = 1024 * 1024; // 1MB
// uploadId 由客户端生成，服务端校验格式后直接使用，保证 init/status/chunk/complete 用同一个 id
const UPLOAD_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

type ChunkMeta = {
  /** 原始文件名（仅用于断点续传状态展示，不作为素材名） */
  fileName: string;
  fileSize: number;
  contentType: string;
  total: number;
  description?: string;
  tagsJson?: string;
  articleId?: string | null;
  spaceId?: string | null;
  syncToWechat?: boolean;
};

function metaPath(uploadId: string) {
  return path.join(TMP_ROOT, `${uploadId}.json`);
}
function chunkDir(uploadId: string) {
  return path.join(TMP_ROOT, uploadId);
}

async function readMeta(uploadId: string): Promise<ChunkMeta | null> {
  try {
    const raw = await fs.readFile(metaPath(uploadId), "utf8");
    return JSON.parse(raw) as ChunkMeta;
  } catch {
    return null;
  }
}
async function writeMeta(uploadId: string, meta: ChunkMeta) {
  await fs.mkdir(TMP_ROOT, { recursive: true });
  await fs.writeFile(metaPath(uploadId), JSON.stringify(meta), "utf8");
}

/** 初始化分片上传会话，使用客户端传入的 uploadId（便于断点续传跨重试保持同一会话） */
async function initUpload(
  uploadId: string,
  body: {
    fileName: string;
    fileSize: number;
    contentType?: string;
    total: number;
    description?: string;
    tags?: string;
    articleId?: string | null;
    spaceId?: string | null;
    syncToWechat?: boolean;
  }
) {
  await fs.mkdir(chunkDir(uploadId), { recursive: true });
  await writeMeta(uploadId, {
    fileName: body.fileName,
    fileSize: body.fileSize,
    contentType: body.contentType ?? "application/octet-stream",
    total: body.total,
    description: body.description ?? "",
    tagsJson: tagsToJson(splitTagInput(body.tags ?? "")),
    articleId: body.articleId ?? null,
    spaceId: body.spaceId ?? null,
    syncToWechat: !!body.syncToWechat,
  });
  return { uploadId, chunkSize: CHUNK_SIZE_DEFAULT };
}

/** 接收单个分片 */
async function receiveChunk(uploadId: string, index: number, data: Buffer) {
  const meta = await readMeta(uploadId);
  if (!meta) throw new Error("上传会话不存在或已过期");
  await fs.writeFile(path.join(chunkDir(uploadId), `part-${index}`), data);
  // 返回已收到分片数
  const files = await fs.readdir(chunkDir(uploadId));
  return { received: files.length, total: meta.total };
}

/** 合并所有分片并写入统一存储层 + 写 Asset */
async function completeUpload(uploadId: string) {
  const meta = await readMeta(uploadId);
  if (!meta) throw new Error("上传会话不存在或已过期");
  if (meta.fileSize > MAX_FILE_SIZE) throw new Error("文件超过 100MB 限制");

  const dir = chunkDir(uploadId);
  const merged = path.join(TMP_ROOT, `${uploadId}.bin`);
  // 按分片顺序合并
  const writeHandle = await fs.open(merged, "w");
  try {
    for (let i = 0; i < meta.total; i++) {
      const part = await fs.readFile(path.join(dir, `part-${i}`));
      await writeHandle.writeFile(part);
    }
  } finally {
    await writeHandle.close();
  }

  const { kind, dir: storageKind } = classifyByContentType(meta.contentType);
  const storageObject = await putFileObject({
    filePath: merged,
    filename: meta.fileName,
    contentType: meta.contentType,
    kind: storageKind,
    articleId: meta.articleId ?? null,
    spaceId: meta.spaceId ?? null,
    metadata: originalFilenameMetadata(meta.fileName),
    preferCloud: true,
  });

  // 落 Asset（双重归属）。名称用自动生成的短 UUID，元数据从会话带入
  const asset = await prisma.asset.create({
    data: {
      name: genAssetName(meta.fileName, meta.contentType),
      ossKey: storageObject.key,
      url: storageObject.url ?? `/api/storage/${storageObject.id}`,
      kind,
      size: storageObject.size,
      contentType: storageObject.contentType,
      storageObjectId: storageObject.id,
      metadataJson: storageObject.metadataJson,
      description: meta.description ?? "",
      tagsJson: meta.tagsJson ?? "[]",
      articleId: meta.articleId ?? null,
      spaceId: meta.spaceId ?? null,
    },
  });
  logMutation("asset", "create", { id: asset.id, kind, chunked: true, syncToWechat: meta.syncToWechat });

  // 同步到公众号素材库（失败不阻塞 OSS 上传，只标记状态）
  let wxSyncStatus: string | null = null;
  let wxSyncError: string | null = null;
  if (meta.syncToWechat) {
    const result = await syncAssetToWechat({
      url: asset.url,
      contentType: asset.contentType,
      filename: asset.name,
    });
    if (result.ok) {
      await prisma.asset.update({
        where: { id: asset.id },
        data: {
          wxUrl: result.wxUrl,
          wxMediaId: result.wxMediaId,
          wxSyncStatus: "success",
          wxSyncError: null,
          wxSyncedAt: new Date(),
        },
      });
      wxSyncStatus = "success";
    } else {
      await prisma.asset.update({
        where: { id: asset.id },
        data: {
          wxSyncStatus: "failed",
          wxSyncError: result.reason,
          wxSyncedAt: new Date(),
        },
      });
      wxSyncStatus = "failed";
      wxSyncError = result.reason;
      log.warn({ id: asset.id, reason: result.reason }, "分片上传同步公众号失败");
    }
  }

  // 清理临时文件
  await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  await fs.rm(merged, { force: true }).catch(() => {});
  await fs.rm(metaPath(uploadId), { force: true }).catch(() => {});

  return { asset: { ...asset, wxSyncStatus, wxSyncError } };
}

export const POST = withApiLog("POST /api/upload/chunk", async (req: NextRequest) => {
  const url = new URL(req.url);
  const action = url.searchParams.get("action") ?? "chunk";

  try {
    // 初始化
    if (action === "init") {
      const body = (await req.json()) as {
        fileName: string;
        fileSize: number;
        contentType?: string;
        total: number;
        description?: string;
        tags?: string;
        articleId?: string | null;
        spaceId?: string | null;
        syncToWechat?: boolean;
      };
      if (!body.fileName?.trim()) {
        return NextResponse.json({ error: "缺少文件名" }, { status: 400 });
      }
      // uploadId 由客户端提供，校验格式（防路径穿越/任意写入）
      const uploadId = url.searchParams.get("uploadId") ?? "";
      if (!UPLOAD_ID_RE.test(uploadId)) {
        return NextResponse.json(
          { error: "uploadId 格式不合法" },
          { status: 400 }
        );
      }
      // 素材名改为自动短 UUID，不会碰撞，无需按原名去重
      const result = await initUpload(uploadId, body);
      return NextResponse.json(result);
    }

    // 接收分片
    if (action === "chunk") {
      const uploadId = url.searchParams.get("uploadId");
      const index = Number(url.searchParams.get("index") ?? "-1");
      if (!uploadId || index < 0) {
        return NextResponse.json({ error: "缺少 uploadId / index" }, { status: 400 });
      }
      const buffer = Buffer.from(await req.arrayBuffer());
      const result = await receiveChunk(uploadId, index, buffer);
      return NextResponse.json({ ok: true, ...result });
    }

    // 完成
    if (action === "complete") {
      const uploadId = url.searchParams.get("uploadId");
      if (!uploadId) {
        return NextResponse.json({ error: "缺少 uploadId" }, { status: 400 });
      }
      const meta = await readMeta(uploadId);
      if (!meta) {
        return NextResponse.json({ error: "上传会话不存在或已过期" }, { status: 404 });
      }
      // 校验分片齐全
      const dir = chunkDir(uploadId);
      const files = await fs.readdir(dir).catch(() => []);
      if (files.length < meta.total) {
        return NextResponse.json(
          { error: `分片不完整（${files.length}/${meta.total}），请补传缺失分片。` },
          { status: 400 }
        );
      }
      const result = await completeUpload(uploadId);
      return NextResponse.json({ ok: true, asset: result.asset });
    }

    return NextResponse.json({ error: "未知 action" }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "上传失败" },
      { status: 400 }
    );
  }
});

/** 查询已上传分片（断点续传）/ 状态 */
export async function GET(req: NextRequest) {
  const uploadId = new URL(req.url).searchParams.get("uploadId");
  if (!uploadId) {
    return NextResponse.json({ error: "缺少 uploadId" }, { status: 400 });
  }
  const meta = await readMeta(uploadId);
  if (!meta) {
    return NextResponse.json({ error: "上传会话不存在或已过期" }, { status: 404 });
  }
  const dir = chunkDir(uploadId);
  const files = await fs.readdir(dir).catch(() => []);
  const received = files
    .map((f) => Number(f.replace("part-", "")))
    .filter((n) => !Number.isNaN(n))
    .sort((a, b) => a - b);
  return NextResponse.json({
    received,
    total: meta.total,
    fileName: meta.fileName,
    fileSize: meta.fileSize,
  });
}

/** 取消并清理临时分片 */
export async function DELETE(req: NextRequest) {
  const uploadId = new URL(req.url).searchParams.get("uploadId");
  if (!uploadId) {
    return NextResponse.json({ error: "缺少 uploadId" }, { status: 400 });
  }
  await fs.rm(chunkDir(uploadId), { recursive: true, force: true }).catch(() => {});
  await fs.rm(metaPath(uploadId), { force: true }).catch(() => {});
  return NextResponse.json({ ok: true });
}
