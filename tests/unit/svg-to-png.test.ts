import { describe, expect, it } from "vitest";
import { isSvg, normalizeSvgForWechatPng } from "../../src/lib/wechat/svg-to-png";

describe("isSvg", () => {
  it("识别标准 MIME image/svg+xml", () => {
    expect(isSvg("image/svg+xml")).toBe(true);
  });

  it("识别无 +xml 后缀的 MIME image/svg", () => {
    expect(isSvg("image/svg")).toBe(true);
  });

  it("MIME 大小写不敏感", () => {
    expect(isSvg("IMAGE/SVG+XML")).toBe(true);
    expect(isSvg("Image/Svg")).toBe(true);
  });

  it("识别 .svg 文件名后缀", () => {
    expect(isSvg(undefined, "diagram.svg")).toBe(true);
  });

  it("识别 .svgz 文件名后缀", () => {
    expect(isSvg(undefined, "archive.svgz")).toBe(true);
  });

  it("文件名后缀大小写不敏感", () => {
    expect(isSvg(undefined, "DIAGRAM.SVG")).toBe(true);
    expect(isSvg(undefined, "mixed.SvGz")).toBe(true);
  });

  it("MIME 优先：即使文件名非 svg 也命中", () => {
    expect(isSvg("image/svg+xml", "image.png")).toBe(true);
  });

  it("文件名兜底：MIME 缺失时按后缀命中", () => {
    expect(isSvg(null, "mermaid-1.svg")).toBe(true);
  });

  it("非 SVG 图片返回 false", () => {
    expect(isSvg("image/png", "cover.png")).toBe(false);
    expect(isSvg("image/jpeg", "photo.jpg")).toBe(false);
  });

  it("非图片类型返回 false", () => {
    expect(isSvg("application/octet-stream", "file.bin")).toBe(false);
    expect(isSvg("video/mp4", "clip.mp4")).toBe(false);
  });

  it("缺少 MIME 与文件名时返回 false", () => {
    expect(isSvg(undefined, undefined)).toBe(false);
    expect(isSvg(null, null)).toBe(false);
    expect(isSvg("", "")).toBe(false);
  });

  it("svg 出现在文件名中间不误判（仅后缀匹配）", () => {
    expect(isSvg("image/png", "svg-export.png")).toBe(false);
  });
});

describe("normalizeSvgForWechatPng", () => {
  it("把 Mermaid foreignObject 标签降级为 SVG text", () => {
    const normalized = normalizeSvgForWechatPng(`
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 80">
        <g class="nodeLabel">
          <foreignObject x="10" y="20" width="180" height="40">
            <div xmlns="http://www.w3.org/1999/xhtml"><span>开始处理</span></div>
          </foreignObject>
        </g>
      </svg>
    `);
    expect(normalized).not.toContain("foreignObject");
    expect(normalized).toContain("<text");
    expect(normalized).toContain("开始处理");
  });
});
