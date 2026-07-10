import { beforeEach, describe, expect, it, vi } from "vitest";

const { findUnique, update, updateMany, writeContentAt, contentExistsAt } = vi.hoisted(() => ({
  findUnique: vi.fn(),
  update: vi.fn(),
  updateMany: vi.fn(),
  writeContentAt: vi.fn(),
  contentExistsAt: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: { article: { findUnique, update, updateMany } },
}));
vi.mock("@/lib/content-store", () => ({
  readContentAt: vi.fn(),
  writeContentAt,
  contentExistsAt,
  articleFilePath: vi.fn(() => "articles/article-1.md"),
}));

import { POST, PUT } from "../../src/app/api/articles/[id]/route";

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

  it("returns the advanced revision after a successful body PUT", async () => {
    updateMany.mockResolvedValue({ count: 1 });
    update.mockResolvedValue({ id: "article-1", contentRevision: 3 });

    const response = await PUT(
      new Request("http://localhost/api/articles/article-1", {
        method: "PUT",
        body: JSON.stringify({ contentMd: "new body", expectedContentRevision: 2 }),
      }),
      { params: Promise.resolve({ id: "article-1" }) }
    );

    await expect(response.json()).resolves.toMatchObject({
      article: { contentMd: "new body", contentRevision: 3 },
    });
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "article-1", contentRevision: 2 },
    }));
    expect(writeContentAt).toHaveBeenCalledWith("articles/article-1.md", "new body");
  });

  it("enforces revision CAS for POST beacon saves too", async () => {
    const response = await POST(
      new Request("http://localhost/api/articles/article-1", {
        method: "POST",
        body: JSON.stringify({ contentMd: "stale", expectedContentRevision: 1 }),
      }),
      { params: Promise.resolve({ id: "article-1" }) }
    );

    expect(response.status).toBe(409);
    expect(writeContentAt).not.toHaveBeenCalled();
  });
});
