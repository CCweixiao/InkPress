import { beforeEach, describe, expect, it, vi } from "vitest";
import { articleVersionHash } from "../../src/lib/ai/article-version";

const {
  findUnique,
  proposalUpdateMany,
  articleUpdateMany,
  proposalUpdate,
  findUniqueOrThrow,
  readContentAt,
  writeContentAt,
} = vi.hoisted(() => ({
  findUnique: vi.fn(),
  proposalUpdateMany: vi.fn(),
  articleUpdateMany: vi.fn(),
  proposalUpdate: vi.fn(),
  findUniqueOrThrow: vi.fn(),
  readContentAt: vi.fn(),
  writeContentAt: vi.fn(),
}));

vi.mock("@/lib/db", () => {
  const tx = {
    article: { updateMany: articleUpdateMany, findUniqueOrThrow },
    agentArticleProposal: { updateMany: proposalUpdateMany, update: proposalUpdate },
  };
  return {
    prisma: {
      article: { updateMany: articleUpdateMany },
      agentArticleProposal: { findUnique, updateMany: proposalUpdateMany },
      $transaction: (fn: (value: typeof tx) => unknown) => fn(tx),
    },
  };
});
vi.mock("@/lib/content-store", () => ({
  readContentAt,
  writeContentAt,
  readTechnicalDocumentContent: vi.fn(),
  writeTechnicalDocumentContent: vi.fn(),
  articleFilePath: vi.fn(() => "articles/article-1.md"),
}));

import { POST } from "../../src/app/api/ai/proposals/[id]/apply/route";

describe("article proposal revision claim", () => {
  beforeEach(() => {
    findUnique.mockReset();
    proposalUpdateMany.mockReset().mockResolvedValue({ count: 1 });
    articleUpdateMany.mockReset().mockResolvedValue({ count: 1 });
    proposalUpdate.mockReset().mockResolvedValue({});
    findUniqueOrThrow.mockReset().mockResolvedValue({ id: "article-1", contentRevision: 1 });
    readContentAt.mockReset().mockResolvedValue("migrated file body");
    writeContentAt.mockReset().mockResolvedValue(undefined);
  });

  it("uses a migrated fallback file instead of legacy contentMd when contentPath is absent", async () => {
    findUnique.mockResolvedValue({
      id: "proposal-1",
      articleId: "article-1",
      status: "pending",
      markdown: "proposal body",
      title: null,
      digest: null,
      baseVersionHash: articleVersionHash({ title: "title", markdown: "migrated file body", digest: "digest" }),
      article: { id: "article-1", title: "title", digest: "digest", contentMd: "stale database body", contentPath: null, spaceId: null, contentRevision: 0 },
    });

    const response = await POST(new Request("http://localhost", { method: "POST", body: "{}" }), {
      params: Promise.resolve({ id: "proposal-1" }),
    });

    expect(response.status).toBe(200);
    expect(readContentAt).toHaveBeenCalledWith("articles/article-1.md");
    expect(writeContentAt).toHaveBeenCalledWith("articles/article-1.md", "proposal body");
  });

  it("does not restore title or digest when a file write fails after a revision claim", async () => {
    findUnique.mockResolvedValue({
      id: "proposal-1", articleId: "article-1", status: "pending", markdown: "proposal body",
      title: "new title", digest: "new digest",
      baseVersionHash: articleVersionHash({ title: "title", markdown: "migrated file body", digest: "digest" }),
      article: { id: "article-1", title: "title", digest: "digest", contentMd: "stale", contentPath: "articles/article-1.md", spaceId: null, contentRevision: 0 },
    });
    writeContentAt.mockRejectedValue(new Error("disk full"));

    const response = await POST(new Request("http://localhost", { method: "POST", body: "{}" }), {
      params: Promise.resolve({ id: "proposal-1" }),
    });

    expect(response.status).toBe(500);
    const rollback = articleUpdateMany.mock.calls.at(-1)?.[0];
    expect(rollback.data).not.toHaveProperty("title");
    expect(rollback.data).not.toHaveProperty("digest");
  });

  it("allows only one of two pending proposals on the same article revision to apply", async () => {
    const base = {
      articleId: "article-1", status: "pending", markdown: "proposal body", title: null, digest: null,
      baseVersionHash: articleVersionHash({ title: "title", markdown: "migrated file body", digest: "digest" }),
      article: { id: "article-1", title: "title", digest: "digest", contentMd: "stale", contentPath: "articles/article-1.md", spaceId: null, contentRevision: 0 },
    };
    findUnique.mockImplementation(({ where }: { where: { id: string } }) => ({ ...base, id: where.id }));
    articleUpdateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });

    const [first, second] = await Promise.all([
      POST(new Request("http://localhost", { method: "POST", body: "{}" }), { params: Promise.resolve({ id: "proposal-1" }) }),
      POST(new Request("http://localhost", { method: "POST", body: "{}" }), { params: Promise.resolve({ id: "proposal-2" }) }),
    ]);

    expect([first.status, second.status].sort()).toEqual([200, 409]);
    expect(writeContentAt).toHaveBeenCalledTimes(1);
  });
});
