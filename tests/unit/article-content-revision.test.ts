import { beforeEach, describe, expect, it, vi } from "vitest";

const { findUnique, update, updateMany, writeContentAt } = vi.hoisted(() => ({
  findUnique: vi.fn(),
  update: vi.fn(),
  updateMany: vi.fn(),
  writeContentAt: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: { article: { findUnique, update, updateMany } },
}));
vi.mock("@/lib/content-store", () => ({
  readContentAt: vi.fn(),
  writeContentAt,
  articleFilePath: vi.fn(() => "articles/article-1.md"),
}));

import { PUT } from "../../src/app/api/articles/[id]/route";

describe("article content revisions", () => {
  beforeEach(() => {
    findUnique.mockReset();
    update.mockReset();
    updateMany.mockReset();
    writeContentAt.mockReset();
    findUnique.mockResolvedValue({
      id: "article-1",
      contentPath: "articles/article-1.md",
      spaceId: null,
      contentRevision: 2,
    });
  });

  it("rejects a stale expectedContentRevision without overwriting content", async () => {
    const response = await PUT(
      new Request("http://localhost/api/articles/article-1", {
        method: "PUT",
        body: JSON.stringify({
          contentMd: "stale overwrite",
          expectedContentRevision: 1,
        }),
      }),
      { params: Promise.resolve({ id: "article-1" }) }
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "revision-conflict",
    });
    expect(writeContentAt).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });
});
