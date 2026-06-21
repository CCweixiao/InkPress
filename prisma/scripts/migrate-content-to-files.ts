/**
 * 一次性迁移脚本：把现有 Article.contentMd 落盘到 storage/articles/<id>.md，
 * 回写 contentPath。contentMd 列保留（兼容），不再作为正文中枢。
 *
 * 运行：pnpm tsx prisma/scripts/migrate-content-to-files.ts
 */
import "dotenv/config";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "../../src/generated/prisma/client";
import { writeContent, relativePath } from "../../src/lib/content-store";

async function main() {
  const url = process.env.DATABASE_URL ?? "file:./dev.db";
  const dbPath = url.startsWith("file:") ? url.slice(5) : url;
  const adapter = new PrismaBetterSqlite3({ url: dbPath });
  const prisma = new PrismaClient({ adapter });

  const articles = await prisma.article.findMany({
    select: { id: true, contentMd: true, contentPath: true },
  });
  console.log(`[migrate] 共 ${articles.length} 篇文章待处理`);

  let migrated = 0;
  let skipped = 0;
  for (const a of articles) {
    // 已有 contentPath 则跳过
    if (a.contentPath) {
      skipped++;
      continue;
    }
    const md = a.contentMd ?? "";
    await writeContent(a.id, md);
    await prisma.article.update({
      where: { id: a.id },
      data: { contentPath: relativePath(a.id) },
    });
    migrated++;
  }

  console.log(`[migrate] 完成：迁移 ${migrated} 篇，跳过 ${skipped} 篇`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error("[migrate] 失败：", e);
  process.exit(1);
});
