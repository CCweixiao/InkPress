import { describe, expect, it } from "vitest";
import {
  extractArticleOutline,
  referencesCurrentArticle,
} from "../../src/lib/ai/current-article";

describe("referencesCurrentArticle", () => {
  it("命中常见「当前文章」指代", () => {
    expect(referencesCurrentArticle("对当前文章生成摘要")).toBe(true);
    expect(referencesCurrentArticle("当前编辑区的文章生成摘要")).toBe(true);
    expect(referencesCurrentArticle("润色本文")).toBe(true);
    expect(referencesCurrentArticle("帮我把这篇文章改得口语化")).toBe(true);
    expect(referencesCurrentArticle("上面的文章再精简一下")).toBe(true);
    expect(referencesCurrentArticle("改写一下原文")).toBe(true);
    expect(referencesCurrentArticle("现有文章太长了")).toBe(true);
    expect(referencesCurrentArticle("当前文档总结一下")).toBe(true);
    expect(referencesCurrentArticle("这份文档提炼要点")).toBe(true);
  });

  it("不误伤非当前文章语境", () => {
    expect(referencesCurrentArticle("写一篇关于边缘计算的文章")).toBe(false);
    expect(referencesCurrentArticle("帮我搜索最新资料")).toBe(false);
    expect(referencesCurrentArticle("")).toBe(false);
    expect(referencesCurrentArticle("   ")).toBe(false);
    // 「文章」单出现但无当前/本/这/上面 等限定，不视为指代当前文章
    expect(referencesCurrentArticle("文章怎么排版比较好")).toBe(false);
  });
});

describe("extractArticleOutline", () => {
  it("提取 ATX 标题并按层级缩进", () => {
    const md = "# 标题\n一些正文\n## 第二节\n### 子节\n## 第三节";
    expect(extractArticleOutline(md)).toEqual([
      "# 标题",
      "  ## 第二节",
      "    ### 子节",
      "  ## 第三节",
    ]);
  });

  it("空文本/无标题返回空数组", () => {
    expect(extractArticleOutline("")).toEqual([]);
    expect(extractArticleOutline("只有正文没有标题")).toEqual([]);
  });

  it("忽略非标题的 # 与代码块内的伪标题（粗略）", () => {
    expect(extractArticleOutline("用 # 表示数字")).toEqual([]);
  });
});
