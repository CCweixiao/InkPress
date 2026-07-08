import { describe, expect, it } from "vitest";
import {
  DEFAULT_EMBEDDING_CONFIG,
  parseEmbeddingConfig,
} from "@/lib/ai/embedding-config";
import { composeEmbeddingInput } from "@/lib/snippets/embedding";
import { mergeKeywordAndSemantic } from "@/lib/snippets/semantic-search";

describe("parseEmbeddingConfig", () => {
  it("完整配置原样解析（baseUrl 去尾斜杠）", () => {
    const c = parseEmbeddingConfig(
      JSON.stringify({
        baseUrl: "https://open.bigmodel.cn/api/paas/v4/",
        apiKey: "sk-1",
        model: "embedding-3",
        dimensions: 1024,
      })
    );
    expect(c).toEqual({
      baseUrl: "https://open.bigmodel.cn/api/paas/v4",
      apiKey: "sk-1",
      model: "embedding-3",
      dimensions: 1024,
    });
  });
  it("缺 dimensions 回落默认 1024", () => {
    const c = parseEmbeddingConfig(JSON.stringify({ baseUrl: "https://x", apiKey: "k" }));
    expect(c.dimensions).toBe(1024);
    expect(c.model).toBe(DEFAULT_EMBEDDING_CONFIG.model);
  });
  it("非法 dimensions 回落 1024", () => {
    const c = parseEmbeddingConfig(
      JSON.stringify({ baseUrl: "https://x", apiKey: "k", dimensions: 1337 })
    );
    expect(c.dimensions).toBe(1024);
  });
  it("合法的低维度 256/512/2048 保留", () => {
    for (const d of [256, 512, 2048] as const) {
      const c = parseEmbeddingConfig(
        JSON.stringify({ baseUrl: "https://x", apiKey: "k", dimensions: d })
      );
      expect(c.dimensions).toBe(d);
    }
  });
  it("缺 baseUrl 抛错", () => {
    expect(() => parseEmbeddingConfig(JSON.stringify({ apiKey: "k" }))).toThrow();
  });
  it("缺 apiKey 抛错", () => {
    expect(() => parseEmbeddingConfig(JSON.stringify({ baseUrl: "https://x" }))).toThrow();
  });
});

describe("composeEmbeddingInput", () => {
  it("text 原样", () => {
    expect(composeEmbeddingInput({ kind: "text", content: "正文素材" })).toBe("正文素材");
  });
  it("quote 附出处", () => {
    expect(
      composeEmbeddingInput({ kind: "quote", content: "保持简单", quoteSource: "某作者" })
    ).toBe("保持简单\n—— 某作者");
  });
  it("quote 无出处不追加", () => {
    expect(composeEmbeddingInput({ kind: "quote", content: "保持简单" })).toBe("保持简单");
  });
  it("link 附 title + description（空段不追加）", () => {
    expect(
      composeEmbeddingInput({
        kind: "link",
        content: "看这个",
        linkTitle: "标题",
        linkDescription: "描述",
      })
    ).toBe("看这个\n标题\n描述");
  });
  it("link 无 title/desc 只剩 content", () => {
    expect(composeEmbeddingInput({ kind: "link", content: "看这个" })).toBe("看这个");
  });
  it("image 用 caption", () => {
    expect(composeEmbeddingInput({ kind: "image", content: "截图说明" })).toBe("截图说明");
  });
  it("短文本（<3）返空串", () => {
    expect(composeEmbeddingInput({ kind: "text", content: "ab" })).toBe("");
  });
  it("超长截断到 1000 字", () => {
    expect(composeEmbeddingInput({ kind: "text", content: "a".repeat(2000) }).length).toBe(1000);
  });
});

describe("mergeKeywordAndSemantic", () => {
  const kw = (ids: string[]) => ids.map((id) => ({ id }));
  it("纯 keyword 原样返回", () => {
    expect(mergeKeywordAndSemantic(kw(["a", "b"]), [], {}, 10)).toEqual(kw(["a", "b"]));
  });
  it("纯 semantic 按 score 降序", () => {
    const sem = kw(["b", "c"]);
    const scores = { b: 0.5, c: 0.9 };
    expect(mergeKeywordAndSemantic([], sem, scores, 10)).toEqual(kw(["c", "b"]));
  });
  it("keyword 优先 + semantic 补充，去重", () => {
    const sem = kw(["a", "c"]); // a 同时命中 keyword
    const scores = { a: 0.99, c: 0.4 };
    expect(mergeKeywordAndSemantic(kw(["a", "b"]), sem, scores, 10)).toEqual(kw(["a", "b", "c"]));
  });
  it("limit 截断", () => {
    const sem = kw(["c", "d", "e"]);
    const scores = { c: 0.5, d: 0.4, e: 0.3 };
    expect(mergeKeywordAndSemantic(kw(["a", "b"]), sem, scores, 3)).toEqual(kw(["a", "b", "c"]));
  });
  it("semantic hit 无对应 snippet 则跳过", () => {
    const scores = { z: 0.9 }; // z 不在 semanticSnippets
    expect(mergeKeywordAndSemantic(kw(["a"]), [], scores, 10)).toEqual(kw(["a"]));
  });
});
