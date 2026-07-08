import { describe, expect, it } from "vitest";
import { parseOgHtml } from "@/lib/snippets/link-og";

describe("parseOgHtml", () => {
  it("og 三件套齐全", () => {
    const html = `<html><head>
      <meta property="og:title" content="标题">
      <meta property="og:description" content="摘要">
      <meta property="og:image" content="https://x.com/a.png">
    </head><body></body></html>`;
    expect(parseOgHtml(html)).toEqual({
      title: "标题",
      description: "摘要",
      image: "https://x.com/a.png",
    });
  });
  it("仅 og:title", () => {
    const html = `<meta property="og:title" content="只有标题">`;
    expect(parseOgHtml(html)).toEqual({ title: "只有标题" });
  });
  it("og 缺失回落 <title> + <meta description>", () => {
    const html = `<html><head><title>页面标题</title>
      <meta name="description" content="页面摘要"></head><body></body></html>`;
    expect(parseOgHtml(html)).toEqual({ title: "页面标题", description: "页面摘要" });
  });
  it("twitter:* 兜底", () => {
    const html = `<meta name="twitter:title" content="TW 标题">
      <meta name="twitter:image" content="https://x.com/tw.png">`;
    expect(parseOgHtml(html)).toEqual({
      title: "TW 标题",
      image: "https://x.com/tw.png",
    });
  });
  it("空 html 返 {}", () => {
    expect(parseOgHtml("")).toEqual({});
  });
  it("纯文本（非 html）返 {}", () => {
    expect(parseOgHtml("hello world 不是 html")).toEqual({});
  });
  it("content 前后空白被 trim", () => {
    const html = `<meta property="og:title" content="  带空白  ">`;
    expect(parseOgHtml(html)).toEqual({ title: "带空白" });
  });
  it("image 保留原始 content（相对路径不补全）", () => {
    const html = `<meta property="og:image" content="/static/img/a.png">`;
    expect(parseOgHtml(html)).toEqual({ image: "/static/img/a.png" });
  });
});
