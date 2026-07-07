import { describe, expect, it } from "vitest";
import {
  buildPastedImageName,
  extractImageFiles,
  isGenericImageName,
  normalizePastedImages,
  rehydrateWithFriendlyName,
} from "../../src/components/materials/useClipboardImagePaste";

/** 构造最小可用的 DataTransfer.items mock（只用到 extractImageFiles 关心的字段）。 */
function fakeDataTransfer(
  items: Array<{ kind: string; type: string; file: File | null }>
): { items: Array<{ kind: string; type: string; getAsFile: () => File | null }> } {
  return {
    items: items.map((it) => ({
      kind: it.kind,
      type: it.type,
      getAsFile: () => it.file,
    })),
  };
}

function imageFile(type = "image/png", name = "image.png"): File {
  return new File(["dummy"], name, { type });
}

describe("extractImageFiles", () => {
  it("提取图片 item，跳过文本/非图片", () => {
    const dt = fakeDataTransfer([
      { kind: "string", type: "text/plain", file: null },
      { kind: "file", type: "image/png", file: imageFile("image/png") },
      { kind: "file", type: "image/jpeg", file: imageFile("image/jpeg", "photo.jpg") },
      { kind: "file", type: "application/pdf", file: imageFile("application/pdf", "a.pdf") },
    ]);
    expect(extractImageFiles(dt as never)).toHaveLength(2);
    expect(extractImageFiles(dt as never).map((f) => f.type)).toEqual([
      "image/png",
      "image/jpeg",
    ]);
  });

  it("空剪贴板 / 非 file kind 返回空数组", () => {
    expect(extractImageFiles(null)).toEqual([]);
    expect(extractImageFiles({ items: [] } as never)).toEqual([]);
  });

  it("getAsFile 返回 null 时跳过该项", () => {
    const dt = fakeDataTransfer([
      { kind: "file", type: "image/png", file: null },
      { kind: "file", type: "image/gif", file: imageFile("image/gif", "x.gif") },
    ]);
    expect(extractImageFiles(dt as never)).toHaveLength(1);
  });
});

describe("isGenericImageName", () => {
  it("image.png / image.jpg / 空 / 大小写均判为泛名", () => {
    expect(isGenericImageName("image.png")).toBe(true);
    expect(isGenericImageName("image.JPG")).toBe(true);
    expect(isGenericImageName("")).toBe(true);
    expect(isGenericImageName("image.jpeg")).toBe(true);
  });

  it("可读名（mac 截图等）保留", () => {
    expect(isGenericImageName("截屏2026-07-02 14.30.00.png")).toBe(false);
    expect(isGenericImageName("screenshot-001.png")).toBe(false);
    expect(isGenericImageName("photo.jpg")).toBe(false);
  });
});

describe("buildPastedImageName", () => {
  const fixed = new Date(2026, 5, 2, 14, 30, 45); // 2026-06-02 14:30:45 本地

  it("生成 paste-YYYYMMDD-HHmmss-<6hex>.<ext> 格式", () => {
    const name = buildPastedImageName("image/png", fixed);
    expect(name).toMatch(/^paste-20260602-143045-[0-9a-f]{6}\.png$/);
  });

  it("按 contentType 选择扩展名（jpeg→jpg）", () => {
    expect(buildPastedImageName("image/jpeg", fixed)).toMatch(/\.jpg$/);
    expect(buildPastedImageName("image/svg+xml", fixed)).toMatch(/\.svg$/);
    expect(buildPastedImageName("image/webp", fixed)).toMatch(/\.webp$/);
  });

  it("未知图片类型默认 png", () => {
    expect(buildPastedImageName("image/heic", fixed)).toMatch(/\.png$/);
  });

  it("带参数（;charset 等）的 contentType 正确解析", () => {
    expect(buildPastedImageName("image/png; charset=utf-8", fixed)).toMatch(
      /^paste-20260602-143045-[0-9a-f]{6}\.png$/
    );
  });
});

describe("rehydrateWithFriendlyName / normalizePastedImages", () => {
  it("rehydrate 保留 type 与 lastModified，仅改 name", () => {
    const original = new File(["abc"], "image.png", {
      type: "image/png",
      lastModified: 123456,
    });
    const renamed = rehydrateWithFriendlyName(original, "paste-x.png");
    expect(renamed.name).toBe("paste-x.png");
    expect(renamed.type).toBe("image/png");
    expect(renamed.lastModified).toBe(123456);
  });

  it("normalize：泛名改写、可读名保留", () => {
    const generic = imageFile("image/png", "image.png");
    const readable = imageFile("image/png", "截屏2026-07-02.png");
    const [a, b] = normalizePastedImages([generic, readable]);
    expect(a.name).not.toBe("image.png");
    expect(a.name).toMatch(/^paste-.+\.png$/);
    expect(b.name).toBe("截屏2026-07-02.png"); // 可读名原样保留
    expect(b.type).toBe("image/png");
  });
});
