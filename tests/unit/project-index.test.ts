import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildProjectIndex,
  projectCallHierarchy,
  projectDependencyGraph,
  queryProjectSymbols,
} from "../../src/lib/ai/project-index";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))
  );
});

async function fixtureProject() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "inkpress-index-"));
  roots.push(root);
  await fs.mkdir(path.join(root, "src"), { recursive: true });
  await fs.writeFile(
    path.join(root, "src", "service.ts"),
    `export function saveUser() { return true }\n`,
    "utf8"
  );
  await fs.writeFile(
    path.join(root, "src", "index.ts"),
    `import { saveUser } from "./service";\nexport function main() { return saveUser(); }\n`,
    "utf8"
  );
  await fs.writeFile(
    path.join(root, "Demo.java"),
    `package demo;\nimport java.util.List;\nclass Demo { void run() { helper(); } void helper() {} }\n`,
    "utf8"
  );
  await fs.writeFile(
    path.join(root, "worker.py"),
    `from app.service import execute\n\ndef run():\n    return execute()\n`,
    "utf8"
  );
  return { id: `fixture-${Date.now()}`, name: "Fixture", root };
}

describe("project static index", () => {
  it("indexes TypeScript, Java and Python symbols and relations", async () => {
    const project = await fixtureProject();
    const index = await buildProjectIndex(project);
    expect(index.snapshotHash).toHaveLength(64);
    expect(index.symbols.some((item) => item.name === "main")).toBe(true);
    expect(index.symbols.some((item) => item.name === "Demo")).toBe(true);
    expect(index.symbols.some((item) => item.name === "run")).toBe(true);
    expect(index.edges.some((item) => item.kind === "imports")).toBe(true);
    expect(index.edges.some((item) => item.kind === "calls")).toBe(true);
    expect(index.files.every((file) => !("content" in file))).toBe(true);
  });

  it("returns bounded symbol, dependency and call hierarchy queries", async () => {
    const project = await fixtureProject();
    await buildProjectIndex(project);
    const symbols = await queryProjectSymbols(project, { query: "main" });
    expect(symbols.symbols[0]?.path).toBe("src/index.ts");
    const dependencies = await projectDependencyGraph(project);
    expect(dependencies.edges.some((edge) => edge.from === "src/index.ts")).toBe(
      true
    );
    const calls = await projectCallHierarchy(project, {
      symbol: "src/index.ts#main",
    });
    expect(calls.edges.some((edge) => edge.to.includes("saveUser"))).toBe(true);
  });
});
