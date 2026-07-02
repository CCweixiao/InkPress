import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import {
  readGitDiff,
  readGitDiffSummary,
  readGitLog,
  inferNaturalGitRange,
  resolveGitRange,
} from "../../src/lib/ai/git-analysis";

const execFileAsync = promisify(execFile);
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))
  );
});

async function git(root: string, args: string[]) {
  const { stdout } = await execFileAsync("git", args, { cwd: root });
  return stdout.trim();
}

async function fixtureRepo() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "inkpress-git-"));
  roots.push(root);
  await git(root, ["init"]);
  await git(root, ["config", "user.name", "InkPress Test"]);
  await git(root, ["config", "user.email", "test@inkpress.local"]);
  await fs.writeFile(path.join(root, "feature.ts"), "export const value = 1;\n");
  await git(root, ["add", "feature.ts"]);
  await git(root, ["commit", "-m", "feat: initial feature"]);
  const base = await git(root, ["rev-parse", "HEAD"]);
  await fs.writeFile(
    path.join(root, "feature.ts"),
    "export const value = 2;\nexport const enabled = true;\n"
  );
  await git(root, ["add", "feature.ts"]);
  await git(root, ["commit", "-m", "feat: enable new behavior"]);
  const head = await git(root, ["rev-parse", "HEAD"]);
  return {
    project: { id: "fixture", name: "Fixture", root },
    base,
    head,
  };
}

describe("read-only git analysis", () => {
  it("turns natural time and version ranges into explicit inputs", () => {
    const now = new Date(2026, 5, 21, 12, 0, 0);
    expect(inferNaturalGitRange("最近一周", now)).toEqual({
      since: "2026-06-14T12:00:00",
      until: "2026-06-21T12:00:00",
    });
    expect(inferNaturalGitRange("v1.2.0 到 v1.3.0")).toEqual({
      base: "v1.2.0",
      head: "v1.3.0",
    });
  });
  it(
    "resolves immutable ranges and reads bounded evidence",
    async () => {
      const { project, base, head } = await fixtureRepo();
      const before = await git(project.root, ["status", "--porcelain"]);
      const range = await resolveGitRange(project, { base, head });
      expect(range.baseCommit).toBe(base);
      expect(range.headCommit).toBe(head);
      const log = await readGitLog(project, range);
      expect(log.commits).toHaveLength(1);
      expect(log.commits[0].subject).toContain("enable new behavior");
      const summary = await readGitDiffSummary(project, range);
      expect(summary.changedFiles[0]).toMatchObject({
        path: "feature.ts",
        additions: 2,
        deletions: 1,
      });
      const diff = await readGitDiff(project, { ...range, file: "feature.ts" });
      expect(diff.diff).toContain("enabled = true");
      expect(await git(project.root, ["status", "--porcelain"])).toBe(before);
    },
    10_000
  );

  it("rejects option injection and sensitive paths", async () => {
    const { project, head } = await fixtureRepo();
    await expect(
      resolveGitRange(project, { base: "--output=/tmp/pwned", head })
    ).rejects.toThrow();
    await expect(
      readGitDiff(project, {
        baseCommit: head,
        headCommit: head,
        file: ".env",
      })
    ).rejects.toThrow();
  });
});
