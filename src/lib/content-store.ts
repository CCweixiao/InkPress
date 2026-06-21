import fs from "node:fs/promises";
import path from "node:path";
import { storageDir } from "@/lib/paths";

/**
 * 文章正文以文件存储（DB 仅存相对路径 contentPath）。
 * 基准目录：~/.inkpress/storage/（桌面应用）或 项目根/storage/（开发）。
 * 不同用户/部署的绝对路径不同，因此 DB 只存相对路径。
 *
 * 路径解析统一走 src/lib/paths.ts（CONTENT_DIR 仍可覆盖，用于测试/自定义部署）。
 */
const STORAGE_ROOT = storageDir();

const ARTICLES_DIR = path.join(STORAGE_ROOT, "articles");
const TECHNICAL_DOCUMENTS_DIR = path.join(STORAGE_ROOT, "technical-documents");

/** 相对 storage 根的路径，如 "articles/<id>.md" */
export function relativePath(id: string): string {
  return path.posix.join("articles", `${sanitizeId(id)}.md`);
}

/** 绝对路径 */
function absolutePath(id: string): string {
  return path.join(STORAGE_ROOT, relativePath(id));
}

export function technicalDocumentRelativePath(id: string): string {
  return path.posix.join("technical-documents", `${sanitizeId(id)}.md`);
}

function technicalDocumentAbsolutePath(id: string): string {
  return path.join(STORAGE_ROOT, technicalDocumentRelativePath(id));
}

function sanitizeId(id: string): string {
  // 仅允许 cuid 字符，避免路径穿越
  return id.replace(/[^a-zA-Z0-9_-]/g, "");
}

/** 写入文章正文（自动建目录，原子写入） */
export async function writeContent(id: string, content: string): Promise<void> {
  const filePath = absolutePath(id);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  // 先写临时文件再 rename，避免并发写损坏
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, content, "utf8");
  await fs.rename(tmp, filePath);
}

/** 读取文章正文；文件不存在返回空串 */
export async function readContent(id: string): Promise<string> {
  try {
    return await fs.readFile(absolutePath(id), "utf8");
  } catch {
    return "";
  }
}

/** 删除文章正文文件（忽略不存在） */
export async function deleteContent(id: string): Promise<void> {
  try {
    await fs.unlink(absolutePath(id));
  } catch {
    // ignore
  }
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
export async function previewSnippet(
  id: string,
  maxLen = 80
): Promise<string> {
  const content = await readContent(id);
  if (!content) return "";
  const stripped = content
    .replace(/^---[\s\S]*?---\n?/, "") // 去 front-matter
    .replace(/[#*`>\-\[\]()!]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return stripped.slice(0, maxLen);
}
