import { NextResponse } from "next/server";
import { withApiLog } from "@/lib/api-log";
import {
  importOneArticle,
  materialsToAssetInputs,
  type AssetInput,
  type ImportOneArticleInput,
} from "@/lib/article-portability-service";
import {
  parseArticleImportZip,
  deriveArticleFromMarkdown,
  extractMediaFromMarkdown,
  detectImportKind,
} from "@/lib/article-portability";

export const runtime = "nodejs";

const MAX_IMPORT_BYTES = 200 * 1024 * 1024; // 200MB（覆盖 zip 与 md）

type FileResult = {
  filename: string;
  ok: boolean;
  id?: string;
  error?: string;
};

/**
 * 批量导入文章：multipart 多个 `file` 字段（.zip / .md 混选）+ spaceId。
 * 每个文件独立解析、独立成败；返回逐文件结果汇总（即使部分失败也 200）。
 * - zip：解包重建文章 + 素材（本地二进制重传 + 链接改写）。
 * - md：派生标题/摘要、剥 front-matter 存正文；提取远程媒体建引用型素材；空文件拒绝。
 */
export const POST = withApiLog("POST /api/articles/import", async (req: Request) => {
  const formData = await req.formData();
  const files = formData.getAll("file").filter((f): f is File => f instanceof File);
  if (files.length === 0) {
    return NextResponse.json(
      { error: "请选择要导入的 .zip 或 .md 文件。" },
      { status: 400 }
    );
  }
  const spaceId = (formData.get("spaceId") as string | null) || null;

  const results: FileResult[] = [];
  for (const file of files) {
    const filename = file.name;
    try {
      if (file.size > MAX_IMPORT_BYTES) {
        throw new Error(`文件过大（超过 ${MAX_IMPORT_BYTES / 1024 / 1024}MB）`);
      }
      const bytes = Buffer.from(await file.arrayBuffer());
      const kind = detectImportKind({
        name: filename,
        contentType: file.type,
        bytes,
      });

      const partial: Omit<ImportOneArticleInput, "spaceId"> = {
        contentMd: "",
        assets: [],
      };
      if (kind === "zip") {
        const parsed = parseArticleImportZip(bytes);
        partial.title = parsed.articleMeta.title;
        partial.digest = parsed.articleMeta.digest;
        partial.profileId = parsed.articleMeta.profileId;
        partial.themeId = parsed.articleMeta.themeId;
        partial.status = parsed.articleMeta.status;
        partial.coverUrl = parsed.articleMeta.coverUrl;
        partial.contentMd = parsed.articleMd;
        partial.assets = materialsToAssetInputs(parsed);
      } else if (kind === "md") {
        const derived = deriveArticleFromMarkdown(bytes.toString("utf8"));
        if (!derived.body.trim()) {
          throw new Error("文件内容为空。");
        }
        partial.title = derived.title;
        partial.digest = derived.digest;
        partial.contentMd = derived.body;
        const mediaAssets: AssetInput[] = extractMediaFromMarkdown(derived.body).map(
          (m) => ({ url: m.url, kind: m.kind, contentType: m.contentType, name: m.name })
        );
        partial.assets = mediaAssets;
      } else {
        throw new Error("请上传 .zip 或 .md 文件。");
      }

      const { id } = await importOneArticle({ spaceId, ...partial });
      results.push({ filename, ok: true, id });
    } catch (err) {
      results.push({
        filename,
        ok: false,
        error: err instanceof Error ? err.message : "导入失败。",
      });
    }
  }

  const imported = results.filter((r) => r.ok).length;
  return NextResponse.json({
    results,
    imported,
    failed: results.length - imported,
  });
});
