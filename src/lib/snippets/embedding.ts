import { prisma } from "@/lib/db";
import { moduleLogger } from "@/lib/logger";
import { getEmbeddingConfig, type EmbeddingConfig } from "@/lib/ai/embedding-config";

const log = moduleLogger("snippets.embedding");

const EMBED_TIMEOUT_MS = 15000;

/** 送入 embedding 的最小字段集（结构兼容 prisma Snippet）。 */
export type SnippetEmbeddingInput = {
  kind: string;
  content: string;
  quoteSource?: string | null;
  linkTitle?: string | null;
  linkDescription?: string | null;
};

const EMBEDDING_MAX_CHARS = 1000;

/**
 * 拼装 embedding 输入（按 kind 附加上下文），截断 ≤1000 字。
 * trim 后 <3 字返空串（调用方据此跳过 embed）。
 */
export function composeEmbeddingInput(s: SnippetEmbeddingInput): string {
  const parts: string[] = [s.content];
  if (s.kind === "quote") {
    const src = (s.quoteSource ?? "").trim();
    if (src) parts.push(`—— ${src}`);
  }
  if (s.kind === "link") {
    const title = (s.linkTitle ?? "").trim();
    const desc = (s.linkDescription ?? "").trim();
    if (title) parts.push(title);
    if (desc) parts.push(desc);
  }
  const joined = parts.join("\n").slice(0, EMBEDDING_MAX_CHARS);
  return joined.trim().length < 3 ? "" : joined;
}

/**
 * 原生 fetch `${baseUrl}/embeddings`（OpenAI 兼容）。超时 15s，吞错返 null。
 * 返回 data[0].embedding（number[]），维度由 config.dimensions 决定。
 */
export async function embedText(
  text: string,
  config: EmbeddingConfig
): Promise<number[] | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), EMBED_TIMEOUT_MS);
    const res = await fetch(`${config.baseUrl}/embeddings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        input: [text],
        dimensions: config.dimensions,
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const data = (await res.json()) as {
      data?: Array<{ embedding?: number[] }>;
    };
    const vec = data.data?.[0]?.embedding;
    return Array.isArray(vec) ? vec : null;
  } catch (e) {
    log.warn({ err: e }, "embedText 失败");
    return null;
  }
}

/**
 * 加载 → composeEmbeddingInput → embedText → 写回 embedding。fire-and-forget 入口。
 * 全程吞错：任何异常只 warn，不影响已返回的 201/200。
 */
export async function generateAndSaveEmbedding(snippetId: string): Promise<void> {
  try {
    const config = await getEmbeddingConfig();
    if (!config) return;
    const s = await prisma.snippet.findUnique({ where: { id: snippetId } });
    if (!s) return;
    const input = composeEmbeddingInput(s);
    if (!input) return;
    const vec = await embedText(input, config);
    if (!vec) return;
    await prisma.snippet.update({
      where: { id: snippetId },
      data: { embedding: JSON.stringify(vec) },
    });
  } catch (e) {
    log.warn({ err: e, snippetId }, "generateAndSaveEmbedding 失败（不阻断）");
  }
}
