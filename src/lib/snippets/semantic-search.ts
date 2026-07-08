import { cosineSimilarity } from "ai";
import { prisma } from "@/lib/db";
import { moduleLogger } from "@/lib/logger";
import { embedText } from "@/lib/snippets/embedding";
import { getEmbeddingConfig } from "@/lib/ai/embedding-config";

const log = moduleLogger("snippets.semantic-search");

/** 单条语义命中（id + 余弦分）。 */
export type SemanticHit = { id: string; score: number };

/**
 * 合并 keyword 命中与 semantic 命中：
 * - keyword 优先，保留原序
 * - semantic 中不在 keyword 集合的，按 score 降序追加
 * - 按 id 去重，semantic hit 无对应 snippet 则跳过
 * - 截断到 limit
 * 纯函数（cosine 已在上游算好），vitest 覆盖。
 */
export function mergeKeywordAndSemantic<T extends { id: string }>(
  keywordSnippets: T[],
  semanticSnippets: T[],
  semanticScores: Record<string, number>,
  limit: number
): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const s of keywordSnippets) {
    if (seen.has(s.id)) continue;
    seen.add(s.id);
    result.push(s);
  }
  const byId = new Map(semanticSnippets.map((s) => [s.id, s]));
  const sortedIds = Object.entries(semanticScores)
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => id);
  for (const id of sortedIds) {
    if (result.length >= limit) break;
    if (seen.has(id)) continue;
    const s = byId.get(id);
    if (!s) continue;
    seen.add(id);
    result.push(s);
  }
  return result.slice(0, limit);
}

/**
 * 语义检索：embed q → 拉所有未删且 embedding 非空的素材 → cosineSimilarity → ≥threshold 取 topK。
 * 未配置 / embed 失败 / 维度不一致（跳过该条）→ 返 []，调用方回落子串。全量吞错。
 */
export async function findSemanticSnippets(
  q: string,
  opts?: { topK?: number; threshold?: number }
): Promise<SemanticHit[]> {
  const topK = opts?.topK ?? 20;
  const threshold = opts?.threshold ?? 0.3;
  try {
    const config = await getEmbeddingConfig();
    if (!config) return [];
    const qVec = await embedText(q, config);
    if (!qVec) return [];
    const rows = await prisma.snippet.findMany({
      where: { trashed: false, NOT: { embedding: null } },
      select: { id: true, embedding: true },
    });
    const scored: SemanticHit[] = [];
    for (const row of rows) {
      if (!row.embedding) continue;
      let vec: unknown;
      try {
        vec = JSON.parse(row.embedding);
      } catch {
        continue;
      }
      if (!Array.isArray(vec) || vec.length !== qVec.length) continue;
      const score = cosineSimilarity(qVec, vec as number[]);
      if (score >= threshold) scored.push({ id: row.id, score });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK);
  } catch (e) {
    log.warn({ err: e }, "findSemanticSnippets 失败（回落子串）");
    return [];
  }
}
