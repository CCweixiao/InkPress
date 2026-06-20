import { seedBuiltInThemes } from "../src/lib/themes/loader";

async function main() {
  console.log("Seeding built-in themes…");
  await seedBuiltInThemes();
  const { prisma } = await import("../src/lib/db");
  const count = await prisma.theme.count();
  console.log(`Done. Themes in DB: ${count}`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
