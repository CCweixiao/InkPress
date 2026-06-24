import fs from "node:fs/promises";
import path from "node:path";
import { systemSkillsDir, userSkillsDir } from "@/lib/paths";

export type SkillCatalogItem = {
  id: string;
  skillKey: string;
  name: string;
  description: string;
  source: "system" | "user";
  hasResources: boolean;
};

const SYSTEM_SKILLS_ROOT = systemSkillsDir(); // resourceRoot/resources/skills/system（只读）
const USER_SKILLS_ROOT = userSkillsDir(); // dataHome/resources/skills/user（可写）
// 双根模型：system（只读，随包发布）+ user（可写，用户创建）。
// 两者始终为不同路径（system/ 与 user/ 子目录），因此不再合并。
const SKILL_ROOTS: Array<{ root: string; source: "system" | "user" }> = [
  { root: USER_SKILLS_ROOT, source: "user" },
  { root: SYSTEM_SKILLS_ROOT, source: "system" },
];
const SKILL_KEY_RE = /^[a-z0-9-]+$/;
const MAX_SKILL_BYTES = 256 * 1024;
const MAX_RESOURCE_BYTES = 512 * 1024;

function parseSkill(raw: string, skillKey: string) {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  const metadata = match?.[1] ?? "";
  const body = (match?.[2] ?? raw).trim();
  const values = new Map<string, string>();
  for (const line of metadata.split("\n")) {
    const separator = line.indexOf(":");
    if (separator < 0) continue;
    let value = line.slice(separator + 1).trim();
    if (
      value.length >= 2 &&
      value[0] === value.at(-1) &&
      (value[0] === '"' || value[0] === "'")
    ) {
      value = value.slice(1, -1);
    }
    values.set(line.slice(0, separator).trim(), value);
  }
  return {
    id: skillKey,
    skillKey,
    name: values.get("name") || skillKey,
    description: values.get("description") || "",
    manual: body,
  };
}

async function resolveSkillRoot(skillKey: string) {
  if (!SKILL_KEY_RE.test(skillKey)) throw new Error("Skill 标识无效。");
  for (const entry of SKILL_ROOTS) {
    const skillsRootPath = entry.root;
    const skillsRoot = await fs.realpath(skillsRootPath).catch(() => null);
    if (!skillsRoot) continue;
    const root = await fs
      .realpath(path.join(skillsRootPath, skillKey))
      .catch(() => null);
    if (!root) continue;
    if (root !== skillsRoot && root.startsWith(`${skillsRoot}${path.sep}`)) {
      return {
        root,
        source: entry.source,
      };
    }
  }
  throw new Error(`Skill 不存在：${skillKey}。`);
}

async function readSkill(skillKey: string) {
  const resolved = await resolveSkillRoot(skillKey);
  const file = path.join(resolved.root, "SKILL.md");
  const stat = await fs.stat(file);
  if (!stat.isFile() || stat.size > MAX_SKILL_BYTES) {
    throw new Error("Skill 文件不存在或超过大小限制。");
  }
  return {
    ...parseSkill(await fs.readFile(file, "utf8"), skillKey),
    root: resolved.root,
    source: resolved.source,
  };
}

async function listResourcePaths(root: string) {
  const paths: string[] = [];
  const walk = async (directory: string) => {
    const entries = await fs
      .readdir(directory, { withFileTypes: true })
      .catch(() => []);
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile()) {
        const relative = path.relative(root, full).replaceAll(path.sep, "/");
        if (relative !== "SKILL.md") paths.push(relative);
      }
    }
  };
  await walk(root);
  return paths.sort();
}

// 短 TTL 缓存：单次对话请求里 listSkills 会被 routeAgentRequest / loadSkill x N /
// createWritingAgent / readSkillResource 反复调用，每次都全量遍历 user+system 两个目录、
// 逐个读 SKILL.md。缓存后同一请求内（秒级）只扫描一次磁盘；技能增删改通过
// invalidateSkillsCache 即时失效（skills-manager 各写入路径调用），TTL 兜底自愈。
const SKILLS_CACHE_TTL_MS = 5_000;
let skillsCache: { value: SkillCatalogItem[]; expires: number } | null = null;

/** 使 listSkills 缓存失效（技能创建/更新/删除/上传后调用，保证 Agent 立即可见）。 */
export function invalidateSkillsCache() {
  skillsCache = null;
}

export async function listSkills(): Promise<SkillCatalogItem[]> {
  const now = Date.now();
  if (skillsCache && skillsCache.expires > now) {
    return skillsCache.value;
  }
  const value = await listSkillsUncached();
  skillsCache = { value, expires: now + SKILLS_CACHE_TTL_MS };
  return value;
}

async function listSkillsUncached(): Promise<SkillCatalogItem[]> {
  const entriesByKey = new Map<string, "user" | "system">();
  for (const { root, source } of [...SKILL_ROOTS].reverse()) {
    const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (
        entry.isDirectory() &&
        !entry.name.startsWith(".") &&
        SKILL_KEY_RE.test(entry.name)
      ) {
        entriesByKey.set(entry.name, source);
      }
    }
  }
  const skills = await Promise.all(
    [...entriesByKey.keys()].map(async (skillKey) => {
        try {
          const skill = await readSkill(skillKey);
          const resources = await listResourcePaths(skill.root);
          return {
            id: skill.id,
            skillKey: skill.skillKey,
            name: skill.name,
            description: skill.description,
            source: skill.source,
            hasResources: resources.length > 0,
          };
        } catch {
          return null;
        }
      })
  );
  return skills
    .filter((skill): skill is SkillCatalogItem => Boolean(skill))
    .sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
}

export async function loadSkill(id: string) {
  const skills = await listSkills();
  const match = skills.find(
    (skill) => skill.id === id || skill.skillKey === id || skill.name === id
  );
  if (!match) throw new Error(`Skill 不存在：${id}。`);
  const skill = await readSkill(match.skillKey);
  return {
    id: skill.id,
    skillKey: skill.skillKey,
    name: skill.name,
    description: skill.description,
    manual: skill.manual,
    resources: await listResourcePaths(skill.root),
  };
}

export async function readSkillResource(id: string, resourcePath: string) {
  const skill = await loadSkill(id);
  if (
    !resourcePath ||
    path.isAbsolute(resourcePath) ||
    resourcePath.includes("\0")
  ) {
    throw new Error("Skill 资源路径无效。");
  }
  const resolved = await resolveSkillRoot(skill.skillKey);
  const root = resolved.root;
  const candidate = path.resolve(root, resourcePath);
  const real = await fs.realpath(candidate);
  if (real !== root && !real.startsWith(`${root}${path.sep}`)) {
    throw new Error("拒绝读取 Skill 目录之外的资源。");
  }
  const stat = await fs.stat(real);
  if (!stat.isFile() || stat.size > MAX_RESOURCE_BYTES) {
    throw new Error("Skill 资源不存在、不是文件或超过大小限制。");
  }
  const buffer = await fs.readFile(real);
  if (buffer.includes(0)) throw new Error("暂不支持读取二进制 Skill 资源。");
  return {
    skill: skill.name,
    path: path.relative(root, real).replaceAll(path.sep, "/"),
    content: buffer.toString("utf8"),
  };
}
