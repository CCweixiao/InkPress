import { describe, expect, it } from "vitest";
import {
  ARTICLE_TYPE_PROFILES,
  ARTICLE_PROFILE_OPTIONS,
  DEFAULT_ARTICLE_PROFILE,
  getArticleProfile,
} from "../../src/lib/ai/article-type-profile";

describe("article-type-profile", () => {
  it("内置 6 个 profile", () => {
    const ids = Object.keys(ARTICLE_TYPE_PROFILES);
    expect(ids).toContain("wechat_essay");
    expect(ids).toContain("technical_deep_dive");
    expect(ids).toContain("product_update");
    expect(ids).toContain("tutorial");
    expect(ids).toContain("news_commentary");
    expect(ids).toContain("case_study");
    expect(ids.length).toBeGreaterThanOrEqual(6);
  });

  it("每个 profile 字段完整且非空", () => {
    for (const p of Object.values(ARTICLE_TYPE_PROFILES)) {
      expect(p.id).toBeTruthy();
      expect(p.name).toBeTruthy();
      expect(p.description).toBeTruthy();
      expect(p.promptSection.length).toBeGreaterThan(20);
      expect(p.checklist.length).toBeGreaterThanOrEqual(3);
      expect(Array.isArray(p.defaultSkills)).toBe(true);
    }
  });

  it("default profile 是 wechat_essay", () => {
    expect(DEFAULT_ARTICLE_PROFILE).toBe("wechat_essay");
  });
});

describe("getArticleProfile", () => {
  it("按 id 返回 profile", () => {
    expect(getArticleProfile("technical_deep_dive").id).toBe("technical_deep_dive");
    expect(getArticleProfile("news_commentary").id).toBe("news_commentary");
  });
  it("空/未知 id 回落默认", () => {
    expect(getArticleProfile(undefined).id).toBe(DEFAULT_ARTICLE_PROFILE);
    expect(getArticleProfile(null).id).toBe(DEFAULT_ARTICLE_PROFILE);
    expect(getArticleProfile("").id).toBe(DEFAULT_ARTICLE_PROFILE);
    expect(getArticleProfile("__not_exist__").id).toBe(DEFAULT_ARTICLE_PROFILE);
  });
  it("technical_deep_dive 含代码探索/git 引导", () => {
    const p = getArticleProfile("technical_deep_dive");
    expect(p.promptSection).toMatch(/project_read|git_log|代码探索/);
    expect(p.checklist.some((c) => /代码|git|证据/.test(c))).toBe(true);
  });
  it("news_commentary 含 web 引导", () => {
    const p = getArticleProfile("news_commentary");
    expect(p.promptSection).toMatch(/web_search|web_fetch/);
  });
});

describe("ARTICLE_PROFILE_OPTIONS", () => {
  it("与 PROFILES 一致", () => {
    expect(ARTICLE_PROFILE_OPTIONS.length).toBe(Object.keys(ARTICLE_TYPE_PROFILES).length);
    for (const opt of ARTICLE_PROFILE_OPTIONS) {
      expect(ARTICLE_TYPE_PROFILES[opt.id]).toBeDefined();
      expect(opt.name).toBe(ARTICLE_TYPE_PROFILES[opt.id].name);
    }
  });
});
