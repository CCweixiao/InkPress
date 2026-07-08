/**
 * 一次性回填既有素材的 embedding（手动跑，不入 entrypoint）：
 *   pnpm tsx scripts/backfill-embeddings.ts
 * 改过 dimensions 后需重跑（旧向量维度不一致会被检索跳过）。
 * 未配置 inkpress.embedding → 提示退出。
 */
import { prisma } from "@/lib/db";
import { generateAndSaveEmbedding } from "@/lib/snippets/embedding";
import { getEmbeddingConfig } from "@/lib/ai/embedding-config";

async function main() {
  const cfg = await getEmbeddingConfig();
  if (!cfg) {
    console.error("未配置 inkpress.embedding，先在设置页配置后重跑。");
    process.exit(1);
  }
  const targets = await prisma.snippet.findMany({
    where: { trashed: false, embedding: null },
    select: { id: true, title: true },
  });
  console.log(
    `待回填 ${targets.length} 条（dimensions=${cfg.dimensions}, model=${cfg.model}）`
  );
  let ok = 0;
  let fail = 0;
  let i = 0;
  for (const t of targets) {
    i++;
    process.stdout.write(`[${i}/${targets.length}] ${t.id} ${t.title.slice(0, 20)} ... `);
    const before = await prisma.snippet.findUnique({
      where: { id: t.id },
      select: { embedding: true },
    });
    await generateAndSaveEmbedding(t.id);
    const after = await prisma.snippet.findUnique({
      where: { id: t.id },
      select: { embedding: true },
    });
    if (after?.embedding && after.embedding !== before?.embedding) {
      ok++;
      console.log("✓");
    } else {
      fail++;
      console.log("✗（跳过/失败）");
    }
  }
  console.log(`\n完成：✓ ${ok}  ✗ ${fail}`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
