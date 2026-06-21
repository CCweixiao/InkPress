import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { AgentProjectConfig } from "@/lib/ai/agent-config";

const execFileAsync = promisify(execFile);
const MAX_READ_BYTES = 256 * 1024;
const MAX_READ_LINES = 240;
const MAX_SEARCH_RESULTS = 50;
const MAX_GLOB_RESULTS = 500;
const MAX_TREE_RESULTS = 800;
const BLOCKED_SEGMENTS = new Set([
  ".git",
  "node_modules",
  ".next",
  "dist",
  "build",
  "coverage",
  "target",
  "vendor",
]);
const BLOCKED_FILE_PATTERNS = [
  /^\.env(?:\.|$)/i,
  /\.(?:pem|key|p12|pfx|jks|keystore)$/i,
  /(?:^|[-_.])(secret|credentials?)(?:[-_.]|$)/i,
];

export function isBlockedRelativePath(relative: string) {
  const normalized = relative.replaceAll("\\", "/");
  const segments = normalized.split("/");
  return (
    segments.some((segment) => BLOCKED_SEGMENTS.has(segment)) ||
    BLOCKED_FILE_PATTERNS.some((pattern) =>
      pattern.test(segments.at(-1) ?? normalized)
    )
  );
}

export async function listProjectFiles(
  project: AgentProjectConfig,
  input: { glob?: string; limit?: number } = {}
) {
  const root = await resolveProjectRoot(project);
  const limit = Math.min(
    MAX_GLOB_RESULTS,
    Math.max(1, input.limit ?? MAX_GLOB_RESULTS)
  );
  const args = [
    "--files",
    "--hidden",
    "-g",
    "!.git/**",
    "-g",
    "!node_modules/**",
    "-g",
    "!.next/**",
    "-g",
    "!dist/**",
    "-g",
    "!build/**",
    "-g",
    "!coverage/**",
    "-g",
    "!target/**",
    "-g",
    "!vendor/**",
    "-g",
    "!**/.env*",
    "-g",
    "!**/*.{pem,key,p12,pfx,jks,keystore}",
  ];
  if (input.glob?.trim()) args.push("-g", input.glob.trim());
  let all: string[];
  try {
    const { stdout } = await execFileAsync("rg", [...args, "."], {
      cwd: root,
      maxBuffer: 4 * 1024 * 1024,
      timeout: 15_000,
    });
    all = stdout
      .split("\n")
      .filter(Boolean)
      .map((item) => item.replace(/^\.\//, "").replaceAll("\\", "/"))
      .filter((item) => !isBlockedRelativePath(item));
  } catch {
    all = await walkProjectFiles(root, input.glob);
  }
  return {
    project: project.name,
    files: all.slice(0, limit),
    truncated: all.length > limit,
  };
}

function globToRegExp(glob?: string) {
  if (!glob) return null;
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replaceAll("**", "\0")
    .replaceAll("*", "[^/]*")
    .replaceAll("\0", ".*")
    .replaceAll("?", ".");
  return new RegExp(`^${escaped}$`);
}

async function walkProjectFiles(root: string, glob?: string) {
  const matcher = globToRegExp(glob);
  const files: string[] = [];
  const stack = [root];
  while (stack.length && files.length < MAX_GLOB_RESULTS * 2) {
    const directory = stack.pop()!;
    const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const absolute = path.join(directory, entry.name);
      const relative = path.relative(root, absolute).replaceAll(path.sep, "/");
      if (isBlockedRelativePath(relative)) continue;
      if (entry.isDirectory()) {
        stack.push(absolute);
      } else if (entry.isFile() && (!matcher || matcher.test(relative))) {
        files.push(relative);
      }
    }
  }
  return files.sort();
}

export async function projectTree(
  project: AgentProjectConfig,
  input: { depth?: number; limit?: number } = {}
) {
  const depth = Math.min(8, Math.max(1, input.depth ?? 3));
  const limit = Math.min(
    MAX_TREE_RESULTS,
    Math.max(1, input.limit ?? MAX_TREE_RESULTS)
  );
  const listed = await listProjectFiles(project, { limit: MAX_TREE_RESULTS });
  const paths = new Set<string>();
  for (const file of listed.files) {
    const segments = file.split("/");
    for (let index = 1; index <= Math.min(depth, segments.length); index++) {
      paths.add(segments.slice(0, index).join("/") + (index < segments.length ? "/" : ""));
      if (paths.size >= limit) break;
    }
    if (paths.size >= limit) break;
  }
  return {
    project: project.name,
    depth,
    entries: [...paths].sort(),
    truncated: listed.truncated || paths.size >= limit,
  };
}

const MANIFEST_FILES = [
  "README.md",
  "README-ZH.md",
  "package.json",
  "pnpm-workspace.yaml",
  "tsconfig.json",
  "pyproject.toml",
  "requirements.txt",
  "pom.xml",
  "build.gradle",
  "build.gradle.kts",
  "settings.gradle",
  "go.mod",
  "Cargo.toml",
];

export async function readProjectManifests(project: AgentProjectConfig) {
  const listed = await listProjectFiles(project, { limit: MAX_GLOB_RESULTS });
  const candidates = listed.files
    .filter((file) => {
      const basename = path.posix.basename(file);
      return (
        MANIFEST_FILES.includes(basename) ||
        (/^README(?:[-_.].+)?\.md$/i.test(basename) &&
          file.split("/").length <= 2)
      );
    })
    .slice(0, 20);
  const manifests = [];
  for (const candidate of candidates) {
    try {
      manifests.push(
        await readProjectFile(project, {
          path: candidate,
          startLine: 1,
          endLine: 160,
        })
      );
    } catch {
      // Ignore unreadable manifests and continue with the remaining project metadata.
    }
  }
  return { project: project.name, manifests };
}

export async function resolveProjectRoot(project: AgentProjectConfig) {
  if (!path.isAbsolute(project.root)) {
    throw new Error(`项目 ${project.name} 的 root 必须是绝对路径。`);
  }
  const root = await fs.realpath(project.root);
  const stat = await fs.stat(root);
  if (!stat.isDirectory()) throw new Error(`项目目录不存在：${project.name}。`);
  return root;
}

export async function resolveProjectFile(
  project: AgentProjectConfig,
  relativePath: string
) {
  if (!relativePath || path.isAbsolute(relativePath)) {
    throw new Error("文件路径必须是项目内的相对路径。");
  }
  const root = await resolveProjectRoot(project);
  const candidate = path.resolve(root, relativePath);
  const real = await fs.realpath(candidate);
  if (real !== root && !real.startsWith(`${root}${path.sep}`)) {
    throw new Error("拒绝读取项目白名单之外的路径。");
  }
  const relative = path.relative(root, real);
  if (isBlockedRelativePath(relative)) throw new Error("该文件属于敏感或排除路径。");
  return { root, real, relative: relative.replaceAll(path.sep, "/") };
}

export async function searchProject(
  project: AgentProjectConfig,
  input: { query: string; glob?: string; limit?: number; regex?: boolean }
) {
  const root = await resolveProjectRoot(project);
  const limit = Math.min(MAX_SEARCH_RESULTS, Math.max(1, input.limit ?? 30));
  const args = [
    "--line-number",
    "--no-heading",
    "--color",
    "never",
    "--smart-case",
    "--max-filesize",
    `${MAX_READ_BYTES}`,
    "-g",
    "!.git/**",
    "-g",
    "!node_modules/**",
    "-g",
    "!.next/**",
    "-g",
    "!dist/**",
    "-g",
    "!build/**",
    "-g",
    "!coverage/**",
    "-g",
    "!target/**",
    "-g",
    "!**/.env*",
    "-g",
    "!**/*.{pem,key,p12,pfx,jks,keystore}",
  ];
  if (!input.regex) args.push("--fixed-strings");
  if (input.glob?.trim()) args.push("-g", input.glob.trim());
  args.push("--", input.query, ".");
  try {
    const { stdout } = await execFileAsync("rg", args, {
      cwd: root,
      maxBuffer: 2 * 1024 * 1024,
      timeout: 12_000,
    });
    const matches = stdout
      .split("\n")
      .filter(Boolean)
      .filter((line) => !isBlockedRelativePath(line.split(":")[0] ?? ""))
      .slice(0, limit);
    return { project: project.name, matches, truncated: matches.length >= limit };
  } catch (error) {
    const candidate = error as { code?: number; stdout?: string };
    if (candidate.code === 1) return { project: project.name, matches: [], truncated: false };
    const listed = await listProjectFiles(project, {
      glob: input.glob,
      limit: MAX_GLOB_RESULTS,
    });
    const matcher = input.regex
      ? new RegExp(input.query, "i")
      : null;
    const matches: string[] = [];
    for (const relative of listed.files) {
      const absolute = path.join(root, relative);
      const stat = await fs.stat(absolute).catch(() => null);
      if (!stat?.isFile() || stat.size > MAX_READ_BYTES) continue;
      const buffer = await fs.readFile(absolute);
      if (buffer.includes(0)) continue;
      const lines = buffer.toString("utf8").split("\n");
      for (let index = 0; index < lines.length; index++) {
        const hit = matcher
          ? matcher.test(lines[index])
          : lines[index].toLowerCase().includes(input.query.toLowerCase());
        if (hit) matches.push(`${relative}:${index + 1}:${lines[index].slice(0, 500)}`);
        if (matches.length >= limit) break;
      }
      if (matches.length >= limit) break;
    }
    return {
      project: project.name,
      matches,
      truncated: matches.length >= limit || listed.truncated,
    };
  }
}

export async function readProjectFile(
  project: AgentProjectConfig,
  input: { path: string; startLine?: number; endLine?: number }
) {
  const resolved = await resolveProjectFile(project, input.path);
  const stat = await fs.stat(resolved.real);
  if (!stat.isFile() || stat.size > MAX_READ_BYTES) {
    throw new Error("文件不存在、不是普通文件或超过读取大小限制。");
  }
  const raw = await fs.readFile(resolved.real);
  if (raw.includes(0)) throw new Error("不支持读取二进制文件。");
  const lines = raw.toString("utf8").split("\n");
  const start = Math.max(1, input.startLine ?? 1);
  const requestedEnd = Math.max(start, input.endLine ?? start + MAX_READ_LINES - 1);
  const end = Math.min(lines.length, requestedEnd, start + MAX_READ_LINES - 1);
  return {
    project: project.name,
    path: resolved.relative,
    startLine: start,
    endLine: end,
    totalLines: lines.length,
    content: lines
      .slice(start - 1, end)
      .map((line, index) => `${start + index}: ${line}`)
      .join("\n"),
  };
}
