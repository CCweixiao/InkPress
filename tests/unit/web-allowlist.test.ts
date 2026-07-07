import { describe, expect, it, vi, beforeEach } from "vitest";

// mock prisma，避免污染 dev.db
vi.mock("@/lib/db", () => ({
  prisma: {
    webFetchDomainAllowlist: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      upsert: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

import {
  normalizeDomain,
  isValidDomain,
  isDomainAllowed,
  listAllowedDomains,
  addAllowedDomain,
  removeAllowedDomain,
} from "../../src/lib/ai/web-allowlist";
import { prisma } from "@/lib/db";

const table = prisma.webFetchDomainAllowlist as unknown as {
  findUnique: ReturnType<typeof vi.fn>;
  findMany: ReturnType<typeof vi.fn>;
  count: ReturnType<typeof vi.fn>;
  upsert: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
};

describe("normalizeDomain", () => {
  it("小写 + 去 scheme/path + 去 www.", () => {
    expect(normalizeDomain("HTTPS://WWW.GitHub.com/x?q=1")).toBe("github.com");
    expect(normalizeDomain("www.example.com")).toBe("example.com");
    expect(normalizeDomain("API.GitHub.com")).toBe("api.github.com");
    expect(normalizeDomain("github.com:443/path")).toBe("github.com");
    expect(normalizeDomain("  GitHub.COM  ")).toBe("github.com");
  });
  it("空串返回空", () => {
    expect(normalizeDomain("")).toBe("");
    expect(normalizeDomain("   ")).toBe("");
  });
});

describe("isValidDomain", () => {
  it("合法域名", () => {
    expect(isValidDomain("github.com")).toBe(true);
    expect(isValidDomain("developer.mozilla.org")).toBe(true);
  });
  it("拒绝无 TLD / IP / 非法", () => {
    expect(isValidDomain("localhost")).toBe(false);
    expect(isValidDomain("192.168.1.1")).toBe(false);
    expect(isValidDomain(".com")).toBe(false);
    expect(isValidDomain("a.")).toBe(false);
  });
});

describe("isDomainAllowed", () => {
  beforeEach(() => table.findUnique.mockReset());
  it("命中白名单 → true", async () => {
    table.findUnique.mockResolvedValue({ id: "1" });
    expect(await isDomainAllowed("https://www.github.com/x")).toBe(true);
    expect(table.findUnique).toHaveBeenCalledWith({
      where: { domain: "github.com" },
      select: { id: true },
    });
  });
  it("未命中 → false", async () => {
    table.findUnique.mockResolvedValue(null);
    expect(await isDomainAllowed("example.com")).toBe(false);
  });
});

describe("listAllowedDomains", () => {
  beforeEach(() => {
    table.findMany.mockReset();
    table.count.mockReset();
  });
  it("分页 + 模糊搜索", async () => {
    table.findMany.mockResolvedValue([
      { id: "1", domain: "github.com", riskJson: "{}" },
    ]);
    table.count.mockResolvedValue(3);
    const r = await listAllowedDomains({ q: "git", page: 1, pageSize: 2 });
    expect(r.total).toBe(3);
    expect(r.hasMore).toBe(true); // 1*2=2 < 3
    expect(r.items).toHaveLength(1);
    expect(table.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { domain: { contains: "git" } },
        skip: 0,
        take: 2,
      })
    );
  });
  it("无 q 时 where 为空对象", async () => {
    table.findMany.mockResolvedValue([]);
    table.count.mockResolvedValue(0);
    await listAllowedDomains({});
    expect(table.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: {} })
    );
  });
});

describe("addAllowedDomain", () => {
  beforeEach(() => table.upsert.mockReset());
  it("归一化 + upsert", async () => {
    table.upsert.mockResolvedValue({
      id: "1",
      domain: "github.com",
      note: "",
      riskJson: "{}",
    });
    const r = await addAllowedDomain("https://www.github.com", "文档");
    expect(r.domain).toBe("github.com");
    expect(table.upsert).toHaveBeenCalledWith({
      where: { domain: "github.com" },
      update: { note: "文档", riskJson: "{}" },
      create: { domain: "github.com", note: "文档", riskJson: "{}" },
      select: { id: true, domain: true, note: true, riskJson: true },
    });
  });
  it("非法域名抛错", async () => {
    await expect(addAllowedDomain("localhost")).rejects.toThrow(/无效/);
    await expect(addAllowedDomain("192.168.1.1")).rejects.toThrow(/无效/);
  });
});

describe("removeAllowedDomain", () => {
  beforeEach(() => table.delete.mockReset());
  it("按 id 删除", async () => {
    table.delete.mockResolvedValue({});
    await removeAllowedDomain("abc");
    expect(table.delete).toHaveBeenCalledWith({ where: { id: "abc" } });
  });
});
