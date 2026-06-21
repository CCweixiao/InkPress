import fs from "node:fs/promises";
import path from "node:path";
import AdmZip from "adm-zip";
import { prisma } from "@/lib/db";
import { systemSkillsDir, userSkillsDir } from "@/lib/paths";

/**
 * 技能仓库管理器（双 root 设计：system 只读 / user 可写）。
 *
 * - 系统 skill：随 app 包发布的只读资源，位于 resourceRoot/resources/skills/system/。
 *   运行时实时读取（不拷贝到用户目录）→ app 更新（替换整个包）即自动全量更新。
 *   source="system"，editable=false（仅查看，不可编辑/删除）。
 * - 用户 skill：用户创建/AI 生成/上传的技能，位于 dataHome/resources/skills/user/。
 *   DB 有 Skill 记录；source="user"，editable=true（可编辑/删除）。
 *
 * 身份判定基于目录归属（system root 下 = system；user root 下 = user），不再用"DB 无记录=系统"的反向推断。
 * DB Skill 表只存 user 技能记录；系统技能从不写 DB。
 */
export const SYSTEM_SKILLS_ROOT = systemSkillsDir(); // 只读 app 资源（运行时实时读取）
export const USER_SKILLS_ROOT = userSkillsDir(); // 用户可写根

/** skill 目录名规范（与 skills.ts readSkill 一致） */
export const SKILL_KEY_RE = /^[a-z0-9-]+$/;
const MAX_SKILL_BYTES = 256 * 1024;

/**
 * 解析某 skillKey 所在目录。
 * - 指定 source 时只查对应根。
 * - 未指定 source 时优先查 user 根（用户同名 skill 覆盖系统 skill），再查 system 根。
 *
 * 返回 { dir, source } 或 null。
 */
export async function resolveSkillDir(
  skillKey: string,
  source?: "system" | "user"
): Promise<{ dir: string; source: "system" | "user" } | null> {
  if (!SKILL_KEY_RE.test(skillKey)) return null;
  const roots: Array<{ root: string; source: "system" | "user" }> =
    source === "system"
      ? [{ root: SYSTEM_SKILLS_ROOT, source: "system" }]
      : source === "user"
        ? [{ root: USER_SKILLS_ROOT, source: "user" }]
        : [
            { root: USER_SKILLS_ROOT, source: "user" },
            { root: SYSTEM_SKILLS_ROOT, source: "system" },
          ];
  for (const { root, source: src } of roots) {
    const candidate = path.join(root, skillKey);
    const exists = await fs.stat(path.join(candidate, "SKILL.md")).catch(() => null);
    if (exists?.isFile()) return { dir: candidate, source: src };
  }
  return null;
}

export type SkillSource = "system" | "user";

export type SkillSummary = {
  id: string; // 用户 skill 为 DB id；系统 skill 为 skillKey
  skillKey: string;
  name: string;
  description: string;
  source: SkillSource;
  editable: boolean;
  hasResources: boolean;
  createdAt: string | null;
  updatedAt: string | null;
};

export type SkillDetail = SkillSummary & {
  manual: string;
  promptHint: string | null;
  manifest: string | null;
};

/** 扫描指定根目录下所有 skillKey */
async function listDiskSkillKeys(root: string): Promise<string[]> {
  const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
  return entries
    .filter((e) => e.isDirectory() && !e.name.startsWith(".") && SKILL_KEY_RE.test(e.name))
    .map((e) => e.name);
}

/** 解析 SKILL.md 文件的 frontmatter + 正文 */
function parseSkillFile(raw: string) {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  const metadata = match?.[1] ?? "";
  const body = (match?.[2] ?? raw).trim();
  const values = new Map<string, string>();
  for (const line of metadata.split("\n")) {
    const sep = line.indexOf(":");
    if (sep < 0) continue;
    values.set(line.slice(0, sep).trim(), line.slice(sep + 1).trim());
  }
  return {
    name: values.get("name") || "",
    description: values.get("description") || "",
    manual: body,
  };
}

/** 读取某 skill 的 SKILL.md（从解析出的目录读取） */
async function readSkillFile(skillKey: string, source?: SkillSource) {
  const resolved = await resolveSkillDir(skillKey, source);
  if (!resolved) return null;
  const file = path.join(resolved.dir, "SKILL.md");
  const stat = await fs.stat(file).catch(() => null);
  if (!stat || !stat.isFile() || stat.size > MAX_SKILL_BYTES) return null;
  return { ...parseSkillFile(await fs.readFile(file, "utf8")), dir: resolved.dir };
}

/** 列出全部技能（合并用户 DB + 系统 root 文件） */
export async function listAllSkills(): Promise<SkillSummary[]> {
  const [userSkills, systemKeys] = await Promise.all([
    prisma.skill.findMany({ orderBy: { createdAt: "desc" } }),
    listDiskSkillKeys(SYSTEM_SKILLS_ROOT),
  ]);

  // 用户已占用的 key 集合（用户 skill 优先于同名系统 skill）
  const usedKeys = new Set(userSkills.map((s) => s.skillKey));

  const systemDetails: (SkillSummary | null)[] = await Promise.all(
    systemKeys
      .filter((key) => !usedKeys.has(key))
      .map(async (key): Promise<SkillSummary | null> => {
        const parsed = await readSkillFile(key, "system");
        if (!parsed) return null;
        return {
          id: key,
          skillKey: key,
          name: parsed.name || key,
          description: parsed.description,
          source: "system",
          editable: false,
          hasResources: await dirHasExtraResources(key, "system"),
          createdAt: null,
          updatedAt: null,
        };
      })
  );

  const systemSkills = systemDetails.filter((s): s is SkillSummary => s !== null);

  const userSummaries: SkillSummary[] = userSkills.map((s) => ({
    id: s.id,
    skillKey: s.skillKey,
    name: s.name,
    description: s.description,
    source: "user",
    editable: true,
    hasResources: s.hasResources,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  }));

  // 用户 skill 置顶（最近创建优先），系统 skill 在后
  return [...userSummaries, ...systemSkills];
}

/** 获取技能详情（按 DB id 或系统 skill 的 key） */
export async function getSkillDetail(id: string): Promise<SkillDetail | null> {
  // 先尝试 DB（用户 skill）
  const userSkill = await prisma.skill.findUnique({ where: { id } }).catch(() => null);
  if (userSkill) {
    return {
      id: userSkill.id,
      skillKey: userSkill.skillKey,
      name: userSkill.name,
      description: userSkill.description,
      manual: userSkill.manual,
      promptHint: userSkill.promptHint,
      manifest: userSkill.manifest,
      source: "user",
      editable: true,
      hasResources: userSkill.hasResources,
      createdAt: userSkill.createdAt.toISOString(),
      updatedAt: userSkill.updatedAt.toISOString(),
    };
  }

  // 否则视为系统 skill（id == skillKey）
  if (!SKILL_KEY_RE.test(id)) return null;
  const parsed = await readSkillFile(id, "system");
  if (!parsed) return null;
  return {
    id,
    skillKey: id,
    name: parsed.name || id,
    description: parsed.description,
    manual: parsed.manual,
    promptHint: null,
    manifest: null,
    source: "system",
    editable: false,
    hasResources: await dirHasExtraResources(id, "system"),
    createdAt: null,
    updatedAt: null,
  };
}

/** 把 name 转为合法的 skill key（小写连字符） */
function slugifyName(name: string): string {
  const slug = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return slug || "skill";
}

/** 生成唯一的 skillKey（与现存 user DB + 两套文件系统目录去重） */
async function uniqueSkillKey(base: string): Promise<string> {
  const slug = slugifyName(base);
  const [userDbKeys, userDiskKeys, systemDiskKeys] = await Promise.all([
    prisma.skill.findMany({ select: { skillKey: true } }),
    listDiskSkillKeys(USER_SKILLS_ROOT),
    listDiskSkillKeys(SYSTEM_SKILLS_ROOT),
  ]);
  const existingKeys = new Set([
    ...userDbKeys.map((s) => s.skillKey),
    ...userDiskKeys,
    ...systemDiskKeys,
  ]);
  if (!existingKeys.has(slug)) return slug;
  let i = 2;
  while (existingKeys.has(`${slug}-${i}`)) i++;
  return `${slug}-${i}`;
}

/** 拼装 SKILL.md 内容 */
function buildSkillMd(name: string, description: string, manual: string): string {
  return `---\nname: ${name}\ndescription: ${description}\n---\n${manual.trim()}\n`;
}

/** 原子写入 SKILL.md 到用户 skill 目录（mkdir -p + tmp + rename） */
async function mirrorSkillFile(skillKey: string, content: string): Promise<void> {
  if (!SKILL_KEY_RE.test(skillKey)) throw new Error("skillKey 非法");
  const target = path.join(USER_SKILLS_ROOT, skillKey, "SKILL.md");
  await fs.mkdir(path.dirname(target), { recursive: true });
  const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, content, "utf8");
  await fs.rename(tmp, target);
}

/** 移除用户 skill 目录（仅用户 root；忽略不存在） */
async function removeSkillDir(skillKey: string): Promise<void> {
  if (!SKILL_KEY_RE.test(skillKey)) return;
  await fs
    .rm(path.join(USER_SKILLS_ROOT, skillKey), { recursive: true, force: true })
    .catch(() => {});
}

/**
 * 扫描某 skill 目录，判断是否存在 SKILL.md 之外的文件/目录（运行时填充 hasResources）。
 * 从指定 source 的根目录定位。
 */
async function dirHasExtraResources(
  skillKey: string,
  source: SkillSource
): Promise<boolean> {
  if (!SKILL_KEY_RE.test(skillKey)) return false;
  const resolved = await resolveSkillDir(skillKey, source);
  if (!resolved) return false;
  let stack: string[] = [];
  try {
    stack = (await fs.readdir(resolved.dir)).filter((n) => !n.startsWith("."));
  } catch {
    return false;
  }
  // 顶层除 SKILL.md 外有任何条目即视为含资源
  return stack.some((n) => n !== "SKILL.md");
}

/* ====================== 压缩包上传 ====================== */

/** 单文件大小上限（防超大文件 / zip bomb 单条） */
const MAX_ENTRY_BYTES = 1 * 1024 * 1024;
/** 整包解压后总大小上限 */
const MAX_TOTAL_BYTES = 10 * 1024 * 1024;

/** 禁止出现的文件名（skill 体系无关文档/系统垃圾） */
const FORBIDDEN_FILES = new Set([
  "README.md",
  "INSTALLATION_GUIDE.md",
  "QUICK_REFERENCE.md",
  "CHANGELOG.md",
  "LICENSE",
  "CODE_OF_CONDUCT.md",
  "CONTRIBUTING.md",
  ".DS_Store",
  "Thumbs.db",
]);

/** 已知的 skill 资源子目录，用于生成 manifest */
const RESOURCE_DIRS = ["scripts", "references", "agents", "assets", "schemas"];

export type SkillManifest = {
  scripts: string[];
  references: string[];
  agents: string[];
  assets: string[];
  schemas: string[];
  extras: string[];
};

function emptyManifest(): SkillManifest {
  return { scripts: [], references: [], agents: [], assets: [], schemas: [], extras: [] };
}

export type ParsedSkillPackage = {
  /** 相对 skill 根的路径 → 文件内容 Buffer */
  files: Map<string, Buffer>;
  name: string;
  description: string;
  manual: string;
  manifest: SkillManifest;
  hasResources: boolean;
};

/**
 * 从 zip buffer 解析出 skill 资源包（不落盘）。严格校验合法性，不合规抛 Error。
 * 支持「扁平式」（SKILL.md 在 zip 根）和「包裹式」（所有文件在单一顶层目录下）。
 */
export function extractSkillFromZip(buffer: Buffer): ParsedSkillPackage {
  let zip: AdmZip;
  try {
    zip = new AdmZip(buffer);
  } catch {
    throw new Error("无法解析压缩包，请确认是有效的 .zip 文件。");
  }

  const entries = zip.getEntries();
  if (entries.length === 0) throw new Error("压缩包为空。");

  // 1) 逐条做安全 + 无关文件过滤，收集「规范化相对路径 → Buffer」
  const rawFiles = new Map<string, Buffer>();
  let totalBytes = 0;
  for (const entry of entries) {
    if (entry.isDirectory) continue;
    const rawName = entry.entryName;
    // 安全：拒绝路径穿越 / 绝对路径 / 空字节
    if (rawName.includes("\0")) throw new Error(`检测到非法路径（含空字节）：${rawName}`);
    if (/^[A-Za-z]:[\\/]/.test(rawName) || rawName.startsWith("/")) {
      throw new Error(`检测到绝对路径，已拒绝：${rawName}`);
    }
    const norm = rawName.replace(/\\/g, "/");
    if (norm.split("/").some((seg) => seg === "..")) {
      throw new Error(`检测到路径穿越（..），已拒绝：${rawName}`);
    }
    // 禁止目录
    const segs = norm.split("/");
    if (segs.some((s) => s === "node_modules" || s === ".git" || s === "__MACOSX")) continue;
    const baseName = segs[segs.length - 1];
    if (FORBIDDEN_FILES.has(baseName)) {
      throw new Error(`检测到 skill 无关文件「${baseName}」，请移除后重新打包。`);
    }
    if (baseName.startsWith(".")) continue; // 跳过隐藏文件
    const content = entry.getData();
    if (content.byteLength > MAX_ENTRY_BYTES) {
      throw new Error(`文件过大（>${MAX_ENTRY_BYTES / 1024 / 1024}MB）：${rawName}`);
    }
    totalBytes += content.byteLength;
    if (totalBytes > MAX_TOTAL_BYTES) {
      throw new Error(`压缩包解压后总体积超过 ${MAX_TOTAL_BYTES / 1024 / 1024}MB 限制。`);
    }
    rawFiles.set(norm, Buffer.from(content));
  }

  if (rawFiles.size === 0) throw new Error("压缩包内没有可用的文件。");

  // 2) 判定是否包裹在单一顶层目录下，剥离前缀
  const topDirs = new Set<string>();
  const topFiles = new Set<string>();
  for (const p of rawFiles.keys()) {
    const idx = p.indexOf("/");
    if (idx < 0) topFiles.add(p);
    else topDirs.add(p.slice(0, idx));
  }
  let wrapDir: string | null = null;
  if (topDirs.size === 1 && topFiles.size === 0) {
    wrapDir = [...topDirs][0];
    if (!SKILL_KEY_RE.test(wrapDir)) {
      throw new Error(`顶层目录名「${wrapDir}」不规范，应为小写字母、数字、连字符。`);
    }
  } else if (topDirs.size >= 1 && topFiles.size === 0 && topDirs.size > 1) {
    throw new Error("压缩包应只含一个 skill（单一顶层目录或扁平结构），检测到多个顶层目录。");
  }

  const strip = (p: string): string => (wrapDir && p.startsWith(wrapDir + "/") ? p.slice(wrapDir.length + 1) : p);

  const files = new Map<string, Buffer>();
  for (const [p, buf] of rawFiles) files.set(strip(p), buf);

  // 3) 必须含 SKILL.md
  const skillMd = files.get("SKILL.md");
  if (!skillMd) throw new Error("压缩包缺少 SKILL.md 文件（应位于根或单一顶层目录下）。");

  const parsed = parseSkillFile(skillMd.toString("utf8"));
  if (!parsed.name) throw new Error("SKILL.md 的 frontmatter 缺少 name 字段。");
  if (!parsed.description) throw new Error("SKILL.md 的 frontmatter 缺少 description 字段。");

  // 4) 构建 manifest（除 SKILL.md 外按已知目录归类）
  const manifest = emptyManifest();
  for (const p of files.keys()) {
    if (p === "SKILL.md") continue;
    const segs = p.split("/");
    const top = segs[0];
    const baseName = segs[segs.length - 1];
    if ((RESOURCE_DIRS as string[]).includes(top)) {
      (manifest as Record<string, string[]>)[top].push(baseName);
    } else {
      manifest.extras.push(p);
    }
  }
  const hasResources = files.size > 1;

  return {
    files,
    name: parsed.name,
    description: parsed.description,
    manual: parsed.manual,
    manifest,
    hasResources,
  };
}

/**
 * 从压缩包创建/更新用户 skill：解压校验 → 原子写全树到 resources/skills/user/<key>/ → upsert DB。
 * skillKey 来自 frontmatter name（slugify + 去重）；写入 user 根，永不触碰 system 根。
 */
export async function createSkillFromZip(buffer: Buffer) {
  const pkg = extractSkillFromZip(buffer);

  // skillKey：已存在的 user skill（DB 记录）即覆盖更新；否则去重（避开 system key 冲突）
  const baseSlug = slugifyName(pkg.name);
  const existingUser = await prisma.skill
    .findUnique({ where: { skillKey: baseSlug } })
    .catch(() => null);
  const systemKeys = new Set(await listDiskSkillKeys(SYSTEM_SKILLS_ROOT));
  // baseSlug 命中 user skill（DB 记录）即覆盖；命中 system 目录则去重；否则新建
  const skillKey =
    existingUser || !systemKeys.has(baseSlug) ? baseSlug : await uniqueSkillKey(pkg.name);
  const destDir = path.join(USER_SKILLS_ROOT, skillKey);

  // 覆盖写：先清空旧目录再写全树（保证更新时删除已废弃的文件）
  await removeSkillDir(skillKey);
  await fs.mkdir(destDir, { recursive: true });

  // 逐文件原子写入（保留子目录结构）
  for (const [relPath, content] of pkg.files) {
    const target = path.join(destDir, relPath);
    // 再次校验：规范化后的路径不得逃逸 destDir
    const resolved = path.resolve(target);
    if (!resolved.startsWith(destDir + path.sep) && resolved !== destDir) {
      throw new Error(`检测到非法路径：${relPath}`);
    }
    await fs.mkdir(path.dirname(target), { recursive: true });
    const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tmp, content);
    await fs.rename(tmp, target);
  }

  const manifestJson = JSON.stringify(pkg.manifest);
  // skillKey 已存在则更新（重新上传新版本），否则新建
  const existing = await prisma.skill.findUnique({ where: { skillKey } });
  let skill;
  if (existing) {
    skill = await prisma.skill.update({
      where: { id: existing.id },
      data: {
        name: pkg.name,
        description: pkg.description,
        manual: pkg.manual,
        manifest: manifestJson,
        hasResources: pkg.hasResources,
      },
    });
  } else {
    skill = await prisma.skill.create({
      data: {
        skillKey,
        name: pkg.name,
        description: pkg.description,
        manual: pkg.manual,
        manifest: manifestJson,
        hasResources: pkg.hasResources,
      },
    });
  }
  return skill;
}

export type CreateSkillInput = {
  name: string;
  description: string;
  manual: string;
  promptHint?: string | null;
};

/** 新建用户 skill：写 DB + 镜像文件到 user 根 */
export async function createSkill(input: CreateSkillInput) {
  const name = input.name.trim();
  if (!name) throw new Error("技能名称不能为空");

  const skillKey = await uniqueSkillKey(name);
  const skill = await prisma.skill.create({
    data: {
      skillKey,
      name,
      description: input.description.trim(),
      manual: input.manual,
      promptHint: input.promptHint ?? null,
    },
  });
  await mirrorSkillFile(skillKey, buildSkillMd(name, input.description.trim(), input.manual));
  return skill;
}

export type UpdateSkillInput = {
  name?: string;
  description?: string;
  manual?: string;
};

/** 更新用户 skill：skillKey 保持不变，重写文件（仅 user 根） */
export async function updateSkill(id: string, input: UpdateSkillInput) {
  const existing = await prisma.skill.findUnique({ where: { id } });
  if (!existing) return null;

  const data: Record<string, unknown> = {};
  if (input.name !== undefined) {
    const name = input.name.trim();
    if (!name) throw new Error("技能名称不能为空");
    data.name = name;
  }
  if (input.description !== undefined) data.description = input.description.trim();
  if (input.manual !== undefined) data.manual = input.manual;

  const updated = await prisma.skill.update({ where: { id }, data });
  await mirrorSkillFile(
    updated.skillKey,
    buildSkillMd(updated.name, updated.description, updated.manual)
  );
  return updated;
}

/** 删除用户 skill：删 DB 行 + 删 user 根目录（永不动 system 根） */
export async function deleteSkill(id: string): Promise<boolean> {
  const existing = await prisma.skill.findUnique({ where: { id } });
  if (!existing) return false;
  await prisma.skill.delete({ where: { id } });
  await removeSkillDir(existing.skillKey);
  return true;
}
