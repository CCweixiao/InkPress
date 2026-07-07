// P4 守门探测：无 codeSource 时，每个代码工具 execute 必须抛「当前没有已授权代码源」。
//   DATABASE_URL=file:./dev.db pnpm tsx scripts/probe-code-guard.ts
import { INKPRESS_TOOLS } from "../src/lib/ai/tools/registry";

async function main() {
  const codeTools = [
    "project_overview",
    "project_search",
    "project_read",
    "project_glob",
    "git_log",
    "git_diff_summary",
    "github_pull_request",
  ];
  const ctx = {
    target: { kind: "article" as const, id: "x", title: "t", markdown: "" },
    sessionId: "x",
    // 故意不传 codeSource
    skillCatalog: [],
    emit: () => undefined,
  };
  let pass = 0;
  for (const name of codeTools) {
    const def = INKPRESS_TOOLS.find((t) => t.name === name);
    if (!def) {
      console.log(`[guard] ${name}: ❌ 未在注册表找到`);
      continue;
    }
    try {
      // 给一个会触发的入参；守门应在进入业务逻辑前抛。
      await def.execute(ctx, name === "github_pull_request" ? { pullNumber: 1 } : { query: "x", path: "a", pattern: "*" });
      console.log(`[guard] ${name}: ❌ 未抛错（守门失效！）`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const ok = msg.includes("已授权代码源") || msg.includes("GitHub");
      console.log(`[guard] ${name}: ${ok ? "✅" : "⚠️"} ${msg.slice(0, 60)}`);
      if (ok) pass++;
    }
  }
  console.log(`\n[guard] ${pass}/${codeTools.length} 守门生效。`);
  if (pass === codeTools.length) console.log("[guard] ✅ 未授权不可读——全工具守门通过。");
}

main().catch((e) => {
  console.error("[guard] 失败:", e);
  process.exit(1);
});
