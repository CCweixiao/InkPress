import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  listSkills,
  loadSkill,
  readSkillResource,
} from "../../src/lib/ai/skills";
import { USER_SKILLS_ROOT } from "../../src/lib/skills-manager";

const key = "test-agent-resource";
// 用户 skill 写入 user 根（与系统 skill 分离）
const root = path.join(USER_SKILLS_ROOT, key);

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe("Agent skill provider", () => {
  it("discovers the built-in Chinese de-AI writing skill (system root)", async () => {
    const skill = await loadSkill("de-ai-writing");
    expect(skill.description).toContain("去除 AI 痕迹");
    expect(skill.resources).toContain("references/ai-trace-index.md");
    expect(skill.manual).toContain("保真润色");
  });

  it("exposes the governed system skills from system root", async () => {
    const catalog = await listSkills();
    const ids = catalog.map((item) => item.id);
    // 系统 skill 均位于 resources/skills/system/，随包发布
    expect(ids).toContain("codebase-exploration");
    expect(ids).toContain("technical-documentation");
    expect(ids).toContain("wechat-writing");
  });

  it("loads user skill manuals and safe text resources (user root)", async () => {
    await fs.mkdir(path.join(root, "references"), { recursive: true });
    await fs.writeFile(
      path.join(root, "SKILL.md"),
      `---\nname: test-agent-resource\ndescription: test resource loading\n---\n# Manual\nUse the reference.\n`,
      "utf8"
    );
    await fs.writeFile(
      path.join(root, "references", "guide.md"),
      "# Guide\nVerified content.",
      "utf8"
    );
    const skill = await loadSkill(key);
    expect(skill.resources).toContain("references/guide.md");
    const resource = await readSkillResource(key, "references/guide.md");
    expect(resource.content).toContain("Verified content");
  });

  it("blocks resource traversal", async () => {
    await fs.mkdir(root, { recursive: true });
    await fs.writeFile(
      path.join(root, "SKILL.md"),
      `---\nname: test-agent-resource\ndescription: test\n---\nManual`,
      "utf8"
    );
    await expect(readSkillResource(key, "../other.txt")).rejects.toThrow();
  });
});
