import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  listProjectFiles,
  readProjectFile,
  resolveProjectFile,
  searchProject,
} from "../../src/lib/ai/project-access";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("project access", () => {
  it("reads only bounded text ranges", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "inkpress-project-"));
    roots.push(root);
    await fs.writeFile(path.join(root, "demo.ts"), "one\ntwo\nthree\n", "utf8");
    const result = await readProjectFile(
      { id: "demo", name: "Demo", root },
      { path: "demo.ts", startLine: 2, endLine: 3 }
    );
    expect(result.content).toContain("2: two");
    expect(result.content).toContain("3: three");
  });

  it("blocks traversal, secrets and symlink escape", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "inkpress-project-"));
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), "inkpress-outside-"));
    roots.push(root, outside);
    await fs.writeFile(path.join(root, ".env"), "SECRET=value", "utf8");
    await fs.writeFile(path.join(outside, "secret.txt"), "secret", "utf8");
    await fs.symlink(path.join(outside, "secret.txt"), path.join(root, "link.txt"));
    const project = { id: "demo", name: "Demo", root };
    await expect(resolveProjectFile(project, ".env")).rejects.toThrow();
    await expect(resolveProjectFile(project, "link.txt")).rejects.toThrow();
    await expect(resolveProjectFile(project, "../outside.txt")).rejects.toThrow();
  });

  it("paginates project file listing and search results", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "inkpress-project-"));
    roots.push(root);
    await fs.writeFile(path.join(root, "a.ts"), "export const valueA = 'needle';\n", "utf8");
    await fs.writeFile(path.join(root, "b.ts"), "export const valueB = 'needle';\n", "utf8");
    await fs.writeFile(path.join(root, "c.ts"), "export const valueC = 'needle';\n", "utf8");
    const project = { id: "demo", name: "Demo", root };

    const firstFiles = await listProjectFiles(project, { glob: "*.ts", limit: 1 });
    expect(firstFiles.total).toBe(3);
    expect(firstFiles.nextOffset).toBe(1);
    const secondFiles = await listProjectFiles(project, {
      glob: "*.ts",
      limit: 1,
      offset: firstFiles.nextOffset ?? 0,
    });
    expect(secondFiles.files[0]).not.toBe(firstFiles.files[0]);

    const firstMatches = await searchProject(project, { query: "needle", limit: 1 });
    expect(firstMatches.total).toBe(3);
    expect(firstMatches.nextOffset).toBe(1);
    const secondMatches = await searchProject(project, {
      query: "needle",
      limit: 1,
      offset: firstMatches.nextOffset ?? 0,
    });
    expect(secondMatches.matches[0]).not.toBe(firstMatches.matches[0]);
  });
});
