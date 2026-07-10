import fs from "node:fs/promises";
import path from "node:path";
import { storageDir } from "@/lib/paths";
import { articlePrefix } from "@/lib/storage/layout";

/**
 * 文章正文以文件存储（DB 仅存相对路径 contentPath，作为正文位置的唯一真相源）。
 * 基准目录：~/.inkpress/storage/（桌面应用）或 项目根/storage/（开发）。
 * 不同用户/部署的绝对路径不同，因此 DB 只存相对路径。
 *
 * 路径布局（复用 src/lib/storage/layout.ts）：
 * - 有 spaceId：spaces/<sid>/articles/<aid>.md
 * - 无 spaceId：articles/<aid>.md（与旧数据一致）
 *
 * 路径解析统一走 src/lib/paths.ts（CONTENT_DIR 仍可覆盖，用于测试/自定义部署）。
 */
const STORAGE_ROOT = storageDir();

const TECHNICAL_DOCUMENTS_DIR = path.join(STORAGE_ROOT, "technical-documents");

const articleWriteTails = new Map<string, Promise<void>>();
/** Serialize article body read/claim/write/finalize flows in this process. */
export async function withArticleContentWriteLock<T>(articleId: string, operation: () => Promise<T>): Promise<T> {
  const previous = articleWriteTails.get(articleId) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  const tail = previous.then(() => current);
  articleWriteTails.set(articleId, tail);
  await previous;
  try { return await operation(); }
  finally {
    release();
    if (articleWriteTails.get(articleId) === tail) articleWriteTails.delete(articleId);
  }
}

function sanitizeId(id: string): string {
  // 仅允许 cuid 字符，避免路径穿越
  return id.replace(/[^a-zA-Z0-9_-]/g, "");
}

/**
 * 文章正文的相对路径（相对 storage 根）。
 * - 有 spaceId：spaces/<sid>/articles/<aid>.md
 * - 无 spaceId：articles/<aid>.md
 */
export function articleFilePath(input: {
  articleId: string;
  spaceId?: string | null;
}): string {
  return `${articlePrefix(input)}.md`;
}

/** 旧数据回退路径：平铺 articles/<id>.md（与历史 contentPath 一致，供迁移/兼容使用） */
export function legacyArticlePath(id: string): string {
  return path.posix.join("articles", `${sanitizeId(id)}.md`);
}

/**
 * 把相对 storage 根的路径解析为绝对路径，并防止目录穿越。
 * contentPath 来自 DB，正常情况下由本模块写入；此处仍做防御性校验。
 */
function resolveAbsolute(relPath: string): string {
  const cleaned = path.posix
    .normalize(relPath)
    .replace(/^\/+/, "")
    .replace(/\0/g, "");
  const abs = path.join(STORAGE_ROOT, cleaned);
  const root = path.resolve(STORAGE_ROOT);
  const resolved = path.resolve(abs);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    // 越界时回落到 storage 根下的 basename，避免读到任意文件
    return path.join(root, path.basename(cleaned) || "unknown");
  }
  return abs;
}

/** 写入文章正文（按相对路径；自动建目录，原子写入） */
export async function writeContentAt(
  relPath: string,
  content: string
): Promise<void> {
  const filePath = resolveAbsolute(relPath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  // 先写临时文件再 rename，避免并发写损坏
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, content, "utf8");
  await fs.rename(tmp, filePath);
}

/** 读取文章正文（按相对路径）；文件不存在返回空串 */
export async function readContentAt(relPath: string): Promise<string> {
  try {
    return await fs.readFile(resolveAbsolute(relPath), "utf8");
  } catch {
    return "";
  }
}

/** Whether an article body file exists, including a deliberately empty body. */
export async function contentExistsAt(relPath: string): Promise<boolean> {
  try {
    await fs.access(resolveAbsolute(relPath));
    return true;
  } catch {
    return false;
  }
}

/** 删除文章正文文件（按相对路径；忽略不存在） */
export async function deleteContentAt(relPath: string): Promise<void> {
  try {
    await fs.unlink(resolveAbsolute(relPath));
  } catch {
    // ignore
  }
}

export function technicalDocumentRelativePath(id: string): string {
  return path.posix.join("technical-documents", `${sanitizeId(id)}.md`);
}

function technicalDocumentAbsolutePath(id: string): string {
  return path.join(STORAGE_ROOT, technicalDocumentRelativePath(id));
}

export async function writeTechnicalDocumentContent(
  id: string,
  content: string
): Promise<void> {
  const filePath = technicalDocumentAbsolutePath(id);
  await fs.mkdir(TECHNICAL_DOCUMENTS_DIR, { recursive: true });
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, content, "utf8");
  await fs.rename(tmp, filePath);
}

export async function readTechnicalDocumentContent(id: string): Promise<string> {
  try {
    return await fs.readFile(technicalDocumentAbsolutePath(id), "utf8");
  } catch {
    return "";
  }
}

export async function deleteTechnicalDocumentContent(id: string): Promise<void> {
  await fs.unlink(technicalDocumentAbsolutePath(id)).catch(() => {});
}

/**
 * 轻量取正文摘要：读文件后裁剪 + 去除 markdown 符号。
 * 供卡片列表使用，避免每条都全量读入（列表页只展示前 N 字）。
 */
export async function previewSnippetAt(
  relPath: string,
  maxLen = 80
): Promise<string> {
  const content = await readContentAt(relPath);
  if (!content) return "";
  const stripped = content
    .replace(/^---[\s\S]*?---\n?/, "") // 去 front-matter
    .replace(/[#*`>\-\[\]()!]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return stripped.slice(0, maxLen);
}
