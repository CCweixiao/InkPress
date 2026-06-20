import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@/generated/prisma/client";

async function main() {
  const adapter = new PrismaBetterSqlite3({ url: "./dev.db" });
  const prisma = new PrismaClient({ adapter });
  const count = await prisma.article.count();
  console.log("OK articles:", count);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
