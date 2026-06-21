import { randomBytes } from "node:crypto";

/**
 * 解析 tagsJson（JSON 字符串数组）为 string[]；格式异常时返回空数组。
 * 集中此处供服务端 / 客户端复用，替代散落在 Space 组件里的 parseTags。
 */
export function parseTags(tagsJson: string): string[] {
  try {
    const t = JSON.parse(tagsJson);
    return Array.isArray(t)
      ? t.filter((x): x is string => typeof x === "string")
      : [];
  } catch {
    return [];
  }
}

/** 标签数组 → JSON 字符串（与 Asset.tagsJson 列存储格式一致） */
export function tagsToJson(tags: string[]): string {
  return JSON.stringify(tags.filter((t) => t.trim()).map((t) => t.trim()));
}

/**
 * 将逗号分隔的标签字符串拆分为去重后的标签数组（兼容中英文逗号）。
 * 与 SpaceDialog 的输入拆分逻辑保持一致。
 */
export function splitTagInput(input: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input.split(/[,，]/)) {
    const t = raw.trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

/**
 * 已知 contentType → 文件扩展名（不含点）。仅覆盖常见类型。
 */
function extFromContentType(contentType: string): string {
  const ct = contentType.split(";")[0].trim().toLowerCase();
  const map: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/gif": "gif",
    "image/webp": "webp",
    "image/svg+xml": "svg",
    "image/bmp": "bmp",
    "image/x-icon": "ico",
    "video/mp4": "mp4",
    "video/webm": "webm",
    "video/quicktime": "mov",
    "video/x-msvideo": "avi",
    "audio/mpeg": "mp3",
    "audio/wav": "wav",
    "application/pdf": "pdf",
    "application/zip": "zip",
    "application/msword": "doc",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
      "docx",
    "application/vnd.ms-excel": "xls",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
    "application/vnd.ms-powerpoint": "ppt",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation":
      "pptx",
    "text/plain": "txt",
    "text/markdown": "md",
    "text/csv": "csv",
    "application/json": "json",
  };
  return map[ct] ?? "";
}

/**
 * 从原始文件名提取扩展名（不含点，小写）。无扩展名返回 ""。
 */
function extFromName(name: string): string {
  const idx = name.lastIndexOf(".");
  if (idx < 0 || idx === name.length - 1) return "";
  return name.slice(idx + 1).toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * 生成素材展示名：8 位 hex 短 UUID + 原扩展名（或按 contentType 推断）。
 * 例如：a1b2c3d4.png。名称全自动，杜绝重复，靠 description/tags 辨认。
 */
export function genAssetName(
  originalName: string,
  contentType: string
): string {
  const shortId = randomBytes(4).toString("hex");
  const ext = extFromName(originalName) || extFromContentType(contentType);
  return ext ? `${shortId}.${ext}` : shortId;
}
