import fs from "node:fs/promises";
import path from "node:path";
import { getModel } from "../src/lib/ai/provider";
import { getAgentConfig } from "../src/lib/ai/agent-config";
import { listSkills } from "../src/lib/ai/skills";
import { routeAgentRequest } from "../src/lib/ai/agent-orchestrator";
import { cacheDir } from "../src/lib/paths";

type EvalCase = {
  prompt: string;
  intent: string;
  skills: string[];
};

async function main() {
  const fixturePath = path.join(
    process.cwd(),
    "tests",
    "fixtures",
    "skill-evals.json"
  );
  const cases = JSON.parse(
    await fs.readFile(fixturePath, "utf8")
  ) as EvalCase[];
  const [{ model }, config, skills] = await Promise.all([
    getModel(),
    getAgentConfig(),
    listSkills(),
  ]);

  const results = [];
  for (const item of cases) {
    const route = await routeAgentRequest({
      model,
      message: item.prompt,
      skills,
      config,
    });
    const missing = item.skills.filter(
      (skill) => !route.skillIds.includes(skill)
    );
    results.push({
      ...item,
      actualIntent: route.intent,
      actualSkills: route.skillIds,
      intentPass: route.intent === item.intent,
      skillPass: missing.length === 0,
      missing,
    });
  }

  const report = {
    generatedAt: new Date().toISOString(),
    total: results.length,
    passed: results.filter((item) => item.intentPass && item.skillPass).length,
    results,
  };
  const outputDir = path.join(cacheDir(), "skill-evals");
  await fs.mkdir(outputDir, { recursive: true });
  await fs.writeFile(
    path.join(outputDir, "report.json"),
    JSON.stringify(report, null, 2),
    "utf8"
  );
  const rows = results
    .map(
      (item) => `<tr>
<td>${item.intentPass && item.skillPass ? "✓" : "✗"}</td>
<td>${escapeHtml(item.prompt)}</td>
<td>${escapeHtml(item.intent)} → ${escapeHtml(item.actualIntent)}</td>
<td>${escapeHtml(item.skills.join(", "))}</td>
<td>${escapeHtml(item.actualSkills.join(", "))}</td>
</tr>`
    )
    .join("\n");
  await fs.writeFile(
    path.join(outputDir, "report.html"),
    `<!doctype html><meta charset="utf-8"><title>InkPress Skill Eval</title>
<style>body{font:14px system-ui;padding:24px;color:#18202b}table{border-collapse:collapse;width:100%}th,td{border:1px solid #d8dee8;padding:8px;text-align:left}th{background:#f5f7fa}</style>
<h1>InkPress Skill Eval</h1><p>${report.passed}/${report.total} passed · ${report.generatedAt}</p>
<table><thead><tr><th>结果</th><th>提示词</th><th>意图</th><th>期望 Skill</th><th>实际 Skill</th></tr></thead><tbody>${rows}</tbody></table>`,
    "utf8"
  );
  console.log(
    `Skill eval: ${report.passed}/${report.total} passed\n${outputDir}`
  );
  if (report.passed !== report.total) process.exitCode = 1;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
