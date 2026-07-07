import { describe, it, expect } from "vitest";
import AdmZip from "adm-zip";
import {
  buildArticleExportZip,
  parseArticleImportZip,
  entryPathError,
  rewriteImageLinks,
  collectLocalStorageIdsFromMd,
  isCloudAssetUrl,
  assetBinaryPath,
  deriveArticleFromMarkdown,
  extractMediaFromMarkdown,
  detectImportKind,
  type ExportMaterialMeta,
} from "@/lib/article-portability";

describe("article-portability", () => {
  describe("isCloudAssetUrl / assetBinaryPath", () => {
    it("区分云 URL 与本地存储 URL", () => {
      expect(isCloudAssetUrl("https://cdn.example.com/x.png")).toBe(true);
      expect(isCloudAssetUrl("http://localhost:9000/a/b")).toBe(true);
      expect(isCloudAssetUrl("/api/storage/abc123")).toBe(false);
      expect(isCloudAssetUrl("")).toBe(false);
    });

    it("assetBinaryPath 带 assets/ 前缀 + assetId 保证唯一，且净化名字", () => {
      expect(assetBinaryPath("c1", "foo bar.png")).toBe("assets/c1-foo-bar.png");
      expect(assetBinaryPath("c2", "")).toBe("assets/c2-asset");
      // 不安全字符折叠为连字符
      expect(assetBinaryPath("c3", "截图 2026.png")).toBe(
        "assets/c3-2026.png"
      );
    });
  });

  describe("buildArticleExportZip ↔ parseArticleImportZip 往返", () => {
    const contentMd =
      "# 标题\n\n![local](/api/storage/abc123)\n\n![cloud](https://cdn.example.com/x.png)";

    const materials: ExportMaterialMeta[] = [
      {
        id: "a1",
        name: "a1.png",
        kind: "image",
        size: 3,
        contentType: "image/png",
        url: "/api/storage/abc123",
        ossKey: "spaces/s/articles/x/assets/images/a1.png",
        description: "本地图",
        tags: ["截图", "封面"],
        metadata: { originalFilename: "原始.png" },
        binary: "assets/a1-a1png",
      },
      {
        id: "a2",
        name: "cloud.png",
        kind: "image",
        size: 0,
        contentType: "image/png",
        url: "https://cdn.example.com/x.png",
        ossKey: "cdn/x.png",
        description: "",
        tags: [],
        metadata: {},
        // 云素材：无 binary
      },
    ];

    const binaries = [
      { name: "assets/a1-a1png", buffer: Buffer.from([1, 2, 3]) },
    ];

    it("本地素材含 binary，云素材不含", () => {
      const zip = buildArticleExportZip({
        article: { title: "我的文章", digest: "摘要", status: "ready" },
        contentMd,
        materials,
        binaries,
      });
      const parsed = parseArticleImportZip(zip);

      expect(parsed.articleMeta.title).toBe("我的文章");
      expect(parsed.articleMeta.digest).toBe("摘要");
      expect(parsed.articleMeta.status).toBe("ready");
      expect(parsed.articleMd).toBe(contentMd);
      expect(parsed.materials).toHaveLength(2);

      const local = parsed.materials[0];
      expect(local.id).toBe("a1");
      expect(local.binary).toBe("assets/a1-a1png");
      expect(local.tags).toEqual(["截图", "封面"]);

      const cloud = parsed.materials[1];
      expect(cloud.binary).toBeUndefined();
      expect(cloud.url).toBe("https://cdn.example.com/x.png");

      expect(parsed.binaries.size).toBe(1);
      expect(parsed.binaries.get("assets/a1-a1png")!.equals(Buffer.from([1, 2, 3]))).toBe(true);
    });

    it("缺少 materials.json 时回落为空素材列表", () => {
      const zip = buildArticleExportZip({
        article: { title: "T" },
        contentMd: "正文",
        materials: [],
        binaries: [],
      });
      // 手工剔除 materials.json，模拟旧格式
      const adm = new AdmZip(zip);
      adm.deleteFile("materials.json");
      const parsed = parseArticleImportZip(adm.toBuffer());
      expect(parsed.materials).toEqual([]);
      expect(parsed.articleMd).toBe("正文");
    });

    it("可显式省略 materials.json，用于仅导出正文与文章元数据", () => {
      const zip = buildArticleExportZip({
        article: { title: "T" },
        contentMd: "正文",
        materials: [],
        binaries: [],
        includeMaterialsManifest: false,
      });
      const adm = new AdmZip(zip);
      expect(adm.getEntry("materials.json")).toBeNull();

      const parsed = parseArticleImportZip(zip);
      expect(parsed.materials).toEqual([]);
      expect(parsed.articleMd).toBe("正文");
    });
  });

  describe("parseArticleImportZip 安全校验", () => {
    function zipWith(files: Record<string, Buffer | string>): Buffer {
      const zip = new AdmZip();
      for (const [name, data] of Object.entries(files)) {
        zip.addFile(
          name,
          Buffer.isBuffer(data) ? data : Buffer.from(data, "utf8")
        );
      }
      return zip.toBuffer();
    }

    it("跳过 __MACOSX / .DS_Store / 隐藏文件，不报错", () => {
      const buf = zipWith({
        "article.md": "hi",
        "article.json": JSON.stringify({ title: "T" }),
        "__MACOSX/._article.md": "x",
        ".DS_Store": "x",
        ".hidden": "x",
      });
      expect(() => parseArticleImportZip(buf)).not.toThrow();
    });

    it("缺少 article.md 抛错", () => {
      const buf = zipWith({
        "article.json": JSON.stringify({ title: "T" }),
      });
      expect(() => parseArticleImportZip(buf)).toThrow(/缺少 article\.md/);
    });

    it("缺少 article.json 抛错", () => {
      const buf = zipWith({ "article.md": "hi" });
      expect(() => parseArticleImportZip(buf)).toThrow(/缺少 article\.json/);
    });

    it("article.json 非法 JSON 抛错", () => {
      const buf = zipWith({
        "article.md": "hi",
        "article.json": "{ not json",
      });
      expect(() => parseArticleImportZip(buf)).toThrow(/JSON|格式/);
    });

    it("只接受 assets/ 下扁平文件，忽略嵌套子目录", () => {
      const buf = zipWith({
        "article.md": "hi",
        "article.json": JSON.stringify({ title: "T" }),
        "assets/flat.png": Buffer.from([1]),
        "assets/sub/nested.png": Buffer.from([2]),
        "README.txt": "ignore me",
      });
      const parsed = parseArticleImportZip(buf);
      expect([...parsed.binaries.keys()]).toEqual(["assets/flat.png"]);
    });

    it("materials.json 声明的 binary 缺失时拒绝，避免静默导入坏链接", () => {
      const buf = zipWith({
        "article.md": "![a](/api/storage/old)",
        "article.json": JSON.stringify({ title: "T" }),
        "materials.json": JSON.stringify({
          items: [{ url: "/api/storage/old", binary: "assets/missing.png" }],
        }),
      });
      expect(() => parseArticleImportZip(buf)).toThrow(/缺少素材二进制/);
    });

    it("materials.json 声明的 binary 必须位于 assets/ 扁平路径", () => {
      const buf = zipWith({
        "article.md": "hi",
        "article.json": JSON.stringify({ title: "T" }),
        "materials.json": JSON.stringify({
          items: [{ binary: "assets/sub/nested.png" }],
        }),
        "assets/flat.png": Buffer.from([1]),
      });
      expect(() => parseArticleImportZip(buf)).toThrow(/非法素材路径/);
    });
  });

  describe("entryPathError（路径安全守卫）", () => {
    it("合法路径返回 null", () => {
      expect(entryPathError("article.md")).toBeNull();
      expect(entryPathError("assets/x.png")).toBeNull();
      expect(entryPathError("a/b/c.json")).toBeNull();
    });

    it("拒绝路径穿越（..）", () => {
      expect(entryPathError("../evil.txt")).toMatch(/穿越|拒绝/);
      expect(entryPathError("a/../../b.txt")).toMatch(/穿越|拒绝/);
      expect(entryPathError("assets/../../../evil")).toMatch(/穿越|拒绝/);
    });

    it("拒绝绝对路径（unix 与 windows 盘符）", () => {
      expect(entryPathError("/etc/passwd")).toMatch(/绝对路径|拒绝/);
      expect(entryPathError("C:/x")).toMatch(/绝对路径|拒绝/);
      expect(entryPathError("C:\\x")).toMatch(/绝对路径|拒绝/);
    });

    it("拒绝含空字节的路径", () => {
      expect(entryPathError("a\0b.txt")).toMatch(/空字节/);
    });
  });

  describe("rewriteImageLinks", () => {
    it("把映射里的旧 URL 改写为新 URL（覆盖 md 图片与 html src）", () => {
      const md =
        '![a](/api/storage/old1) 文本 <img src="/api/storage/old1"> 尾';
      const urlMap = new Map([["/api/storage/old1", "/api/storage/new1"]]);
      const out = rewriteImageLinks(md, urlMap);
      expect(out).not.toContain("/api/storage/old1");
      expect(out.match(/\/api\/storage\/new1/g)).toHaveLength(2);
    });

    it("未在 urlMap 的 URL 原样保留（云 URL / 外链）", () => {
      const md = "![c](https://cdn.example.com/x.png)";
      const urlMap = new Map([["/api/storage/old", "/api/storage/new"]]);
      expect(rewriteImageLinks(md, urlMap)).toBe(md);
    });

    it("空 urlMap 直接返回原文", () => {
      const md = "![a](/api/storage/old)";
      expect(rewriteImageLinks(md, new Map())).toBe(md);
    });
  });

  describe("collectLocalStorageIdsFromMd", () => {
    it("提取正文里所有 /api/storage/<id> 的 id（去重）", () => {
      const md =
        "![a](/api/storage/abc) ![b](/api/storage/def) ![c](https://cdn/x) ![](https://cdn/x) again /api/storage/abc";
      const ids = new Set(collectLocalStorageIdsFromMd(md));
      expect(ids).toEqual(new Set(["abc", "def"]));
    });

    it("无引用返回空数组", () => {
      expect(collectLocalStorageIdsFromMd("纯文本没有图")).toEqual([]);
    });
  });

  describe("deriveArticleFromMarkdown", () => {
    it("front-matter 的 title/description 优先，body 剥掉 front-matter", () => {
      const md = "---\ntitle: 我的标题\ndescription: 这是摘要\n---\n正文内容";
      const d = deriveArticleFromMarkdown(md);
      expect(d.title).toBe("我的标题");
      expect(d.digest).toBe("这是摘要");
      expect(d.body.trim()).toBe("正文内容");
      expect(d.body).not.toContain("title:");
    });

    it("无 front-matter、有 H1 → 取 H1 作标题", () => {
      const d = deriveArticleFromMarkdown("# 标题一\n\n正文段落");
      expect(d.title).toBe("标题一");
    });

    it("无 H1 → 取首个非空行作标题", () => {
      const d = deriveArticleFromMarkdown(
        "这是一段开头，没有标题符号。\n\n第二段。"
      );
      expect(d.title).toBe("这是一段开头，没有标题符号。");
    });

    it("无 front-matter 描述 → 摘要取正文片段", () => {
      const d = deriveArticleFromMarkdown("第一段内容用于摘要。\n\n第二段。");
      expect(d.digest).toContain("第一段内容用于摘要");
    });

    it("空 / 纯空白 → 兜底标题、空摘要、空 body", () => {
      const d = deriveArticleFromMarkdown("   \n  \n  ");
      expect(d.title).toBe("导入的文章");
      expect(d.digest).toBe("");
      expect(d.body.trim()).toBe("");
    });

    it("超长标题截断到 200", () => {
      const long = "标".repeat(300);
      const d = deriveArticleFromMarkdown(`# ${long}\n\n正文`);
      expect(d.title.length).toBe(200);
      expect(d.title).toBe("标".repeat(200));
    });
  });

  describe("extractMediaFromMarkdown", () => {
    const md = [
      "![图1](https://a.com/x.png)",
      "<img src='https://b.com/y.jpg'>",
      "<video src='https://c.com/v.mp4'></video>",
      "<audio><source src='https://d.com/a.mp3' type='audio/mpeg'></audio>",
      "[文档](https://e.com/doc.pdf)",
      "[普通网页](https://f.com/page.html)", // .html 非媒体 → 跳过
      "![本地图](/api/storage/abc)", // 非 http → 跳过
    ].join("\n");

    it("识别图片/视频/音频/文件并分类正确 kind", () => {
      const media = extractMediaFromMarkdown(md);
      const byUrl = Object.fromEntries(media.map((m) => [m.url, m]));
      expect(media.length).toBe(5);
      expect(byUrl["https://a.com/x.png"].kind).toBe("image");
      expect(byUrl["https://a.com/x.png"].contentType).toBe("image/png");
      expect(byUrl["https://b.com/y.jpg"].kind).toBe("image");
      expect(byUrl["https://c.com/v.mp4"].kind).toBe("video");
      expect(byUrl["https://d.com/a.mp3"].kind).toBe("audio");
      expect(byUrl["https://e.com/doc.pdf"].kind).toBe("file");
    });

    it("跳过非媒体扩展与非 http 链接", () => {
      const media = extractMediaFromMarkdown(md);
      expect(media.find((m) => m.url.includes("page.html"))).toBeUndefined();
      expect(media.find((m) => m.url === "/api/storage/abc")).toBeUndefined();
    });

    it("同一 URL 只出现一次（去重）", () => {
      const media = extractMediaFromMarkdown(
        "![a](https://x.com/a.png) 再来一次 ![a](https://x.com/a.png)"
      );
      expect(media.filter((m) => m.url === "https://x.com/a.png")).toHaveLength(1);
    });
  });

  describe("detectImportKind", () => {
    it("zip magic bytes → zip（即使扩展名是 .md）", () => {
      const zipBytes = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0]);
      expect(detectImportKind({ name: "a.md", bytes: zipBytes })).toBe("zip");
      expect(detectImportKind({ name: "a.zip", bytes: zipBytes })).toBe("zip");
    });

    it(".md / .markdown 扩展名 → md", () => {
      expect(
        detectImportKind({ name: "note.md", bytes: Buffer.from("# hi") })
      ).toBe("md");
      expect(
        detectImportKind({ name: "note.markdown", bytes: Buffer.from("hi") })
      ).toBe("md");
    });

    it("text/markdown content-type → md", () => {
      expect(
        detectImportKind({
          name: "note",
          contentType: "text/markdown",
          bytes: Buffer.from("hi"),
        })
      ).toBe("md");
    });

    it("其它扩展名（.txt）→ null", () => {
      expect(
        detectImportKind({ name: "a.txt", bytes: Buffer.from("hi") })
      ).toBeNull();
    });
  });
});
