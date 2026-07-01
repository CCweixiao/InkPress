import { describe, expect, it, vi } from "vitest";
import {
  searchWithTavily,
  fetchWebPage,
  htmlToText,
  isIsoLike,
} from "../../src/lib/ai/tools/web-research";

type MockRes = {
  ok: boolean;
  status: number;
  headers: { get: (k: string) => string | null };
  text: () => Promise<string>;
  json: () => Promise<unknown>;
};

function mockResponse(
  body: unknown,
  opts?: {
    ok?: boolean;
    status?: number;
    contentType?: string;
    location?: string;
  }
): MockRes {
  return {
    ok: opts?.ok ?? true,
    status: opts?.status ?? 200,
    headers: {
      get: (key) => {
        if (key.toLowerCase() === "location") return opts?.location ?? null;
        if (key.toLowerCase() === "content-type") {
          return opts?.contentType ?? "text/html; charset=utf-8";
        }
        return null;
      },
    },
    text: async () => (typeof body === "string" ? body : ""),
    json: async () => body,
  };
}

describe("searchWithTavily", () => {
  it("解析 Tavily 响应为 WebSource[]", async () => {
    const fetchImpl = vi.fn(async () =>
      mockResponse({
        results: [
          {
            title: "T1",
            url: "https://a.com/1",
            content: "C1",
            published_date: "2026-01-01",
          },
          { title: "T2", url: "https://b.com/2", content: "C2" },
        ],
        answer: "A",
      })
    );
    const r = await searchWithTavily({
      query: "q",
      apiKey: "k",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(r.results).toHaveLength(2);
    expect(r.results[0]).toMatchObject({
      title: "T1",
      url: "https://a.com/1",
      snippet: "C1",
      publishedAt: "2026-01-01",
    });
    expect(r.results[0].sourceType).toBe("unknown");
    expect(isIsoLike(r.results[0].fetchedAt)).toBe(true);
    expect(r.rawAnswer).toBe("A");
  });

  it("过滤无 url 的结果", async () => {
    const fetchImpl = vi.fn(async () =>
      mockResponse({ results: [{ title: "x" }, { url: "https://a.com" }] })
    );
    const r = await searchWithTavily({
      query: "q",
      apiKey: "k",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(r.results).toHaveLength(1);
    expect(r.results[0].url).toBe("https://a.com");
  });

  it("无 key 抛错", async () => {
    await expect(searchWithTavily({ query: "q", apiKey: "" })).rejects.toThrow(
      /Tavily API Key/
    );
  });

  it("空 query 抛错", async () => {
    await expect(searchWithTavily({ query: "   ", apiKey: "k" })).rejects.toThrow(
      /关键词/
    );
  });

  it("HTTP 非 ok 抛错含状态码", async () => {
    const fetchImpl = vi.fn(async () =>
      mockResponse("bad", { ok: false, status: 401 })
    );
    await expect(
      searchWithTavily({
        query: "q",
        apiKey: "k",
        fetchImpl: fetchImpl as unknown as typeof fetch,
      })
    ).rejects.toThrow(/401/);
  });
});

describe("fetchWebPage", () => {
  it("抽取 HTML 标题与正文（去 script/style/标签，解码实体）", async () => {
    const html =
      "<html><head><title>页标题</title></head><body><script>bad()</script><style>x{}</style><p>正文 &amp; 更多</p></body></html>";
    const fetchImpl = vi.fn(async () => mockResponse(html));
    const r = await fetchWebPage({
      url: "https://example.com",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(r.title).toBe("页标题");
    expect(r.text).toContain("正文 & 更多");
    expect(r.text).not.toContain("bad()");
    expect(r.text).not.toContain("<script>");
    expect(r.text).not.toContain("<style>");
    expect(isIsoLike(r.fetchedAt)).toBe(true);
  });

  it("超长正文截断到 maxChars", async () => {
    const long = "a".repeat(5000);
    const html = `<html><body><p>${long}</p></body></html>`;
    const fetchImpl = vi.fn(async () => mockResponse(html));
    const r = await fetchWebPage({
      url: "https://example.com",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      maxChars: 1000,
    });
    expect(r.text.length).toBeLessThanOrEqual(1000);
  });

  it("非 HTML 响应直返原文，标题用 url", async () => {
    const fetchImpl = vi.fn(async () =>
      mockResponse("plain text body", { contentType: "text/plain" })
    );
    const r = await fetchWebPage({
      url: "https://example.com",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(r.text).toContain("plain text body");
    // assertSafePublicUrl 会规范化 URL（补尾斜杠），标题取自规范化后的 url。
    expect(r.title).toContain("example.com");
    expect(r.url).toContain("example.com");
  });

  it("SSRF：本机/内网地址在 fetch 前被拒（fetchImpl 不被调）", async () => {
    const fetchImpl = vi.fn(async () => mockResponse("x"));
    for (const url of [
      "http://localhost",
      "http://127.0.0.1",
      "http://192.168.1.1",
      "http://10.0.0.1",
    ]) {
      fetchImpl.mockClear();
      await expect(
        fetchWebPage({ url, fetchImpl: fetchImpl as unknown as typeof fetch })
      ).rejects.toThrow(/本机|内网/);
      expect(fetchImpl).not.toHaveBeenCalled();
    }
  });

  it("SSRF：重定向到本机/内网地址时拒绝且不继续抓取", async () => {
    const fetchImpl = vi.fn(async () =>
      mockResponse("", {
        ok: false,
        status: 302,
        location: "http://127.0.0.1/private",
      })
    );

    await expect(
      fetchWebPage({
        url: "https://example.com",
        fetchImpl: fetchImpl as unknown as typeof fetch,
      })
    ).rejects.toThrow(/本机|内网/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("公开地址重定向会逐跳校验并读取最终页面", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        mockResponse("", {
          ok: false,
          status: 302,
          location: "https://example.com/final",
        })
      )
      .mockResolvedValueOnce(mockResponse("<title>Final</title><p>ok</p>"));

    const r = await fetchWebPage({
      url: "https://example.com/start",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(r.url).toBe("https://example.com/final");
    expect(r.title).toBe("Final");
    expect(r.text).toContain("ok");
  });

  it("HTTP 非 ok 抛错含状态码", async () => {
    const fetchImpl = vi.fn(async () =>
      mockResponse("", { ok: false, status: 404 })
    );
    await expect(
      fetchWebPage({
        url: "https://example.com",
        fetchImpl: fetchImpl as unknown as typeof fetch,
      })
    ).rejects.toThrow(/404/);
  });
});

describe("htmlToText", () => {
  it("去标签 + 解码实体", () => {
    const { title, text } = htmlToText(
      "<title>T</title><body><p>a &lt; b &amp; c</p></body>"
    );
    expect(title).toBe("T");
    expect(text).toContain("a < b & c");
  });

  it("无 title 时返回空标题", () => {
    expect(htmlToText("<p>x</p>").title).toBe("");
  });
});
