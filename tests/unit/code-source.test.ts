import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  extractCodeSourceCandidate,
  validateLocalCodeSource,
} from "../../src/lib/ai/code-source";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))
  );
});

describe("dynamic code source detection", () => {
  it("extracts a local absolute path without requiring configured projects", () => {
    expect(
      extractCodeSourceCandidate(
        "能加载到本地项目：/Users/jielongping/OpenProjects/aiwaji 吗？"
      )
    ).toMatchObject({
      kind: "local-path",
      root: "/Users/jielongping/OpenProjects/aiwaji",
      displayName: "aiwaji",
    });
    expect(
      extractCodeSourceCandidate('分析项目 "/Users/name/My Projects/demo repo"')
    ).toMatchObject({
      kind: "local-path",
      root: "/Users/name/My Projects/demo repo",
    });
  });

  it("extracts GitHub repositories, refs, commits and pull requests", () => {
    expect(
      extractCodeSourceCandidate(
        "分析 https://github.com/openai/codex/tree/main 的入口"
      )
    ).toMatchObject({
      kind: "github-repository",
      owner: "openai",
      repo: "codex",
      ref: "main",
    });
    expect(
      extractCodeSourceCandidate(
        "分析 https://github.com/openai/codex/pull/42 的改动"
      )
    ).toMatchObject({
      kind: "github-repository",
      ref: "pull/42/head",
      selectorKind: "pull",
    });
    expect(extractCodeSourceCandidate("分析代码 src/app 的调用链")).toBeNull();
  });

  it("rejects broad or credential-bearing local directories", async () => {
    await expect(validateLocalCodeSource(os.homedir())).rejects.toThrow();
    await expect(
      validateLocalCodeSource(path.join(os.homedir(), ".ssh"))
    ).rejects.toThrow();
  });

  it("canonicalizes an allowed source directory", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "inkpress-source-"));
    roots.push(root);
    await expect(validateLocalCodeSource(root)).resolves.toBe(
      await fs.realpath(root)
    );
  });
});
