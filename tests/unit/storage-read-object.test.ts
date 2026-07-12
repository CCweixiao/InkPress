import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  storageObjectFindUnique: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    storageObject: { findUnique: mocks.storageObjectFindUnique },
  },
}));

vi.mock("@/lib/paths", () => ({
  storageDir: () => "/tmp/inkpress-storage-test",
}));

vi.mock("@/lib/oss", () => ({
  deleteFromOss: vi.fn(),
  getOssConfig: vi.fn(),
  multipartUploadFileToOss: vi.fn(),
  uploadBufferToOss: vi.fn(),
  uploadBufferToOssKey: vi.fn(),
}));

vi.mock("@/lib/storage-config", () => ({
  getStorageConfig: vi.fn(),
}));

import { readStorageObjectBuffer } from "@/lib/storage";

describe("readStorageObjectBuffer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("downloads a non-local storage object from its public object URL", async () => {
    mocks.storageObjectFindUnique.mockResolvedValue({
      id: "storage-1",
      provider: "aliyun-oss",
      key: "covers/cover.png",
      url: "https://assets.example.com/covers/cover.png",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
      })
    );

    const buffer = await readStorageObjectBuffer("storage-1");

    expect(Buffer.from(buffer)).toEqual(Buffer.from([1, 2, 3]));
    expect(fetch).toHaveBeenCalledWith(
      "https://assets.example.com/covers/cover.png",
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });

  it("throws a clear error when a non-local object has no readable URL", async () => {
    mocks.storageObjectFindUnique.mockResolvedValue({
      id: "storage-1",
      provider: "aliyun-oss",
      key: "covers/cover.png",
      url: null,
    });

    await expect(readStorageObjectBuffer("storage-1")).rejects.toThrow(
      "云存储对象缺少可读取的对象 URL。"
    );
  });
});
