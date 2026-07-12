import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { classifyByContentType } from "@/lib/oss";
import { genAssetName, tagsToJson } from "@/lib/asset";
import {
  deleteStorageObject,
  originalFilenameMetadata,
  putBufferObject,
  readStorageObjectBuffer,
} from "@/lib/storage";
import {
  backfillCoverMaterialCache,
  deleteWxMaterial,
  uploadCoverBuffer,
} from "@/lib/wechat/material";
import { moduleLogger } from "@/lib/logger";
import { withApiLog } from "@/lib/api-log";

export const runtime = "nodejs";
const MAX_COVER_SIZE = 10 * 1024 * 1024;
const log = moduleLogger("wechat.cover");

async function readAssetBuffer(asset: {
  storageObjectId: string | null;
  url: string;
}): Promise<Buffer> {
  if (asset.storageObjectId) {
    try {
      return await readStorageObjectBuffer(asset.storageObjectId);
    } catch {
      // 云存储对象不能直接读本地文件，继续从公开 URL 下载。
    }
  }
  if (!/^https?:\/\//i.test(asset.url)) {
    throw new Error("该素材没有可读取的本地对象或公开 URL。");
  }
  const response = await fetch(asset.url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`下载素材失败：HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

async function bindExistingAsset(articleId: string, assetId: string, accountId?: string) {
  const asset = await prisma.asset.findUnique({ where: { id: assetId } });
  if (!asset || asset.trashed) {
    return NextResponse.json({ error: "素材不存在或已在回收站。" }, { status: 404 });
  }
  if (asset.kind !== "image") {
    return NextResponse.json({ error: "封面只能选择图片素材。" }, { status: 400 });
  }

  const accountSync = accountId
    ? await prisma.wechatAssetSync.findUnique({
        where: { assetId_accountId: { assetId: asset.id, accountId } },
      })
    : null;
  let uploaded = accountSync?.wxMediaId
    ? { mediaId: accountSync.wxMediaId, url: accountSync.wxUrl ?? "" }
    : !accountId && asset.wxMediaId
    ? { mediaId: asset.wxMediaId, url: asset.wxUrl ?? "" }
    : null;
  let newlyUploaded = false;
  try {
    if (!uploaded) {
      const buffer = await readAssetBuffer(asset);
      if (buffer.byteLength > MAX_COVER_SIZE) throw new Error("封面图片不能超过 10MB。");
      uploaded = await uploadCoverBuffer({
        buffer,
        contentType: asset.contentType,
        filename: asset.name,
      }, accountId);
      newlyUploaded = true;
    }
    const selected = uploaded;
    await prisma.$transaction(async (tx) => {
      await tx.asset.update({
        where: { id: asset.id },
        data: {
          wxMediaId: selected.mediaId,
          wxUrl: selected.url,
          wxSyncStatus: "success",
          wxSyncError: null,
          wxSyncedAt: new Date(),
        },
      });
      if (accountId) {
        await tx.wechatAssetSync.upsert({
          where: { assetId_accountId: { assetId: asset.id, accountId } },
          create: {
            assetId: asset.id,
            accountId,
            wxMediaId: selected.mediaId,
            wxUrl: selected.url,
            status: "success",
            error: null,
            syncedAt: new Date(),
          },
          update: {
            wxMediaId: selected.mediaId,
            wxUrl: selected.url,
            status: "success",
            error: null,
            syncedAt: new Date(),
          },
        });
      }
      await tx.article.update({
        where: { id: articleId },
        data: {
          coverAssetId: asset.id,
          coverMediaId: selected.mediaId,
          coverUrl: asset.url,
        },
      });
    });
    await backfillCoverMaterialCache(asset.url, selected).catch(() => {});
    log.info(
      { articleId, assetId: asset.id, accountId, mediaId: selected.mediaId, reused: !newlyUploaded },
      "已从素材库设置文章封面"
    );
    return NextResponse.json({ ok: true, asset, ...selected, reused: !newlyUploaded });
  } catch (error) {
    if (newlyUploaded && uploaded?.mediaId) {
      await deleteWxMaterial(uploaded.mediaId).catch((cleanupError) =>
        log.warn({ err: cleanupError, mediaId: uploaded?.mediaId }, "回滚微信封面素材失败")
      );
    }
    if (!newlyUploaded) throw error;
    await prisma.asset.update({
      where: { id: asset.id },
      data: {
        wxSyncStatus: "failed",
        wxSyncError: error instanceof Error ? error.message : "封面同步失败",
        wxSyncedAt: new Date(),
      },
    }).catch(() => {});
    if (accountId) {
      await prisma.wechatAssetSync.upsert({
        where: { assetId_accountId: { assetId: asset.id, accountId } },
        create: {
          assetId: asset.id,
          accountId,
          status: "failed",
          error: error instanceof Error ? error.message : "封面同步失败",
          syncedAt: new Date(),
        },
        update: {
          status: "failed",
          error: error instanceof Error ? error.message : "封面同步失败",
          syncedAt: new Date(),
        },
      }).catch(() => {});
    }
    throw error;
  }
}

async function uploadNewCover(articleId: string, file: File, accountId?: string) {
  if (!file.type.startsWith("image/")) {
    return NextResponse.json({ error: "封面只能上传图片文件。" }, { status: 400 });
  }
  if (file.size > MAX_COVER_SIZE) {
    return NextResponse.json({ error: "封面图片不能超过 10MB。" }, { status: 400 });
  }
  const article = await prisma.article.findUnique({ where: { id: articleId }, select: { id: true, spaceId: true } });
  if (!article) return NextResponse.json({ error: "文章不存在。" }, { status: 404 });

  const buffer = Buffer.from(await file.arrayBuffer());
  // 先上传微信。失败时尚未创建 StorageObject/Asset，因此不会污染素材库。
  const uploaded = await uploadCoverBuffer({
    buffer,
    contentType: file.type,
    filename: file.name,
  }, accountId);
  let storageObject: Awaited<ReturnType<typeof putBufferObject>> | null = null;
  try {
    const { kind, dir } = classifyByContentType(file.type);
    if (kind !== "image") throw new Error("封面只能上传图片文件。");
    storageObject = await putBufferObject({
      buffer,
      filename: file.name,
      contentType: file.type,
      kind: dir,
      articleId,
      spaceId: article.spaceId,
      metadata: originalFilenameMetadata(file.name),
      preferCloud: true,
    });
    const stored = storageObject;
    const asset = await prisma.$transaction(async (tx) => {
      const created = await tx.asset.create({
        data: {
          name: genAssetName(file.name, file.type),
          ossKey: stored.key,
          url: stored.url ?? `/api/storage/${stored.id}`,
          kind: "image",
          size: stored.size,
          contentType: stored.contentType,
          storageObjectId: stored.id,
          metadataJson: stored.metadataJson,
          description: "",
          tagsJson: tagsToJson(["封面"]),
          articleId,
          spaceId: article.spaceId,
          wxMediaId: uploaded.mediaId,
          wxUrl: uploaded.url,
          wxSyncStatus: "success",
          wxSyncError: null,
          wxSyncedAt: new Date(),
        },
      });
      if (accountId) {
        await tx.wechatAssetSync.upsert({
          where: { assetId_accountId: { assetId: created.id, accountId } },
          create: {
            assetId: created.id,
            accountId,
            wxMediaId: uploaded.mediaId,
            wxUrl: uploaded.url,
            status: "success",
            error: null,
            syncedAt: new Date(),
          },
          update: {
            wxMediaId: uploaded.mediaId,
            wxUrl: uploaded.url,
            status: "success",
            error: null,
            syncedAt: new Date(),
          },
        });
      }
      await tx.article.update({
        where: { id: articleId },
        data: {
          coverAssetId: created.id,
          coverMediaId: uploaded.mediaId,
          coverUrl: created.url,
        },
      });
      return created;
    });
    await backfillCoverMaterialCache(asset.url, uploaded).catch(() => {});
    log.info(
      { articleId, assetId: asset.id, mediaId: uploaded.mediaId },
      "新封面上传并绑定成功"
    );
    return NextResponse.json({ ok: true, asset, ...uploaded, reused: false });
  } catch (error) {
    await Promise.allSettled([
      deleteWxMaterial(uploaded.mediaId),
      deleteStorageObject(storageObject?.id),
    ]);
    log.error(
      { err: error, articleId, mediaId: uploaded.mediaId, storageObjectId: storageObject?.id },
      "封面本地入库失败，已执行补偿清理"
    );
    throw error;
  }
}

async function postCover(req: Request) {
  try {
    const contentType = req.headers.get("content-type") ?? "";
    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      const articleId = String(form.get("articleId") ?? "");
      const accountId = String(form.get("accountId") ?? "") || undefined;
      const file = form.get("file");
      if (!articleId || !(file instanceof File)) {
        return NextResponse.json({ error: "缺少 articleId 或封面文件。" }, { status: 400 });
      }
      return await uploadNewCover(articleId, file, accountId);
    }
    const body = (await req.json().catch(() => ({}))) as { articleId?: unknown; assetId?: unknown; accountId?: unknown };
    const articleId = typeof body.articleId === "string" ? body.articleId : "";
    const assetId = typeof body.assetId === "string" ? body.assetId : "";
    const accountId = typeof body.accountId === "string" && body.accountId ? body.accountId : undefined;
    if (!articleId || !assetId) {
      return NextResponse.json({ error: "缺少 articleId 或 assetId。" }, { status: 400 });
    }
    return await bindExistingAsset(articleId, assetId, accountId);
  } catch (error) {
    log.warn({ err: error }, "设置文章封面失败");
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "设置文章封面失败。" },
      { status: 500 }
    );
  }
}

export const POST = withApiLog("POST /api/wechat/cover", postCover);
