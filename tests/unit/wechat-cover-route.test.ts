import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  articleFindUnique: vi.fn(),
  assetFindUnique: vi.fn(),
  assetCreate: vi.fn(),
  assetUpdate: vi.fn(),
  articleUpdate: vi.fn(),
  putBufferObject: vi.fn(),
  deleteStorageObject: vi.fn(),
  readStorageObjectBuffer: vi.fn(),
  uploadCoverBuffer: vi.fn(),
  deleteWxMaterial: vi.fn(),
  backfillCoverMaterialCache: vi.fn(),
}));

vi.mock("@/lib/db", () => {
  const tx = {
    asset: { create: mocks.assetCreate, update: mocks.assetUpdate },
    article: { update: mocks.articleUpdate },
  };
  return {
    prisma: {
      article: { findUnique: mocks.articleFindUnique },
      asset: { findUnique: mocks.assetFindUnique, update: mocks.assetUpdate },
      $transaction: (operation: (client: typeof tx) => unknown) => operation(tx),
    },
  };
});
vi.mock("@/lib/storage", () => ({
  putBufferObject: mocks.putBufferObject,
  deleteStorageObject: mocks.deleteStorageObject,
  readStorageObjectBuffer: mocks.readStorageObjectBuffer,
  originalFilenameMetadata: (filename: string) => ({ originalFilename: filename }),
}));
vi.mock("@/lib/wechat/material", () => ({
  uploadCoverBuffer: mocks.uploadCoverBuffer,
  deleteWxMaterial: mocks.deleteWxMaterial,
  backfillCoverMaterialCache: mocks.backfillCoverMaterialCache,
}));
vi.mock("@/lib/logger", () => ({
  moduleLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));
vi.mock("@/lib/api-log", () => ({
  withApiLog: (_route: string, handler: unknown) => handler,
}));

import { POST } from "../../src/app/api/wechat/cover/route";

describe("POST /api/wechat/cover", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.articleFindUnique.mockResolvedValue({ id: "article-1", spaceId: null });
    mocks.uploadCoverBuffer.mockResolvedValue({ mediaId: "wx-cover-1", url: "wx://cover" });
    mocks.putBufferObject.mockResolvedValue({
      id: "storage-1",
      key: "images/cover.png",
      url: "/api/storage/storage-1",
      size: 3,
      contentType: "image/png",
      metadataJson: "{}",
    });
    mocks.assetCreate.mockResolvedValue({
      id: "asset-1",
      name: "cover.png",
      url: "/api/storage/storage-1",
      kind: "image",
    });
    mocks.assetUpdate.mockResolvedValue({});
    mocks.articleUpdate.mockResolvedValue({});
    mocks.deleteStorageObject.mockResolvedValue(undefined);
    mocks.deleteWxMaterial.mockResolvedValue(undefined);
    mocks.backfillCoverMaterialCache.mockResolvedValue(undefined);
  });

  function uploadRequest() {
    const form = new FormData();
    form.append("articleId", "article-1");
    form.append("file", new File([new Uint8Array([1, 2, 3])], "cover.png", { type: "image/png" }));
    return new Request("http://localhost/api/wechat/cover", { method: "POST", body: form });
  }

  it("does not create storage or asset rows when WeChat upload fails", async () => {
    mocks.uploadCoverBuffer.mockRejectedValue(new Error("微信上传失败"));

    const response = await POST(uploadRequest());

    expect(response.status).toBe(500);
    expect(mocks.putBufferObject).not.toHaveBeenCalled();
    expect(mocks.assetCreate).not.toHaveBeenCalled();
    expect(mocks.articleUpdate).not.toHaveBeenCalled();
  });

  it("creates the asset only after WeChat upload succeeds", async () => {
    const response = await POST(uploadRequest());

    expect(response.status).toBe(200);
    expect(mocks.uploadCoverBuffer).toHaveBeenCalledTimes(1);
    expect(mocks.putBufferObject).toHaveBeenCalledTimes(1);
    expect(mocks.assetCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        wxMediaId: "wx-cover-1",
        wxSyncStatus: "success",
      }),
    }));
    expect(mocks.articleUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ coverAssetId: "asset-1", coverMediaId: "wx-cover-1" }),
    }));
  });

  it("reuses an existing asset media id without uploading again", async () => {
    mocks.assetFindUnique.mockResolvedValue({
      id: "asset-existing",
      name: "existing.png",
      url: "/api/storage/existing",
      kind: "image",
      contentType: "image/png",
      storageObjectId: "storage-existing",
      wxMediaId: "wx-existing",
      wxUrl: "wx://existing",
      trashed: false,
    });
    const response = await POST(
      new Request("http://localhost/api/wechat/cover", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ articleId: "article-1", assetId: "asset-existing" }),
      })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      mediaId: "wx-existing",
      reused: true,
    });
    expect(mocks.uploadCoverBuffer).not.toHaveBeenCalled();
    expect(mocks.articleUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ coverAssetId: "asset-existing", coverMediaId: "wx-existing" }),
    }));
  });
});
