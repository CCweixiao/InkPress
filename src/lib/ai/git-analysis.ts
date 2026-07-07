import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import type { AgentProjectConfig } from "@/lib/ai/agent-config";
import { isBlockedRelativePath, resolveProjectRoot } from "@/lib/ai/project-access";

const execFileAsync = promisify(execFile);
const MAX_COMMITS = 100;
const MAX_CHANGED_FILES = 300;
const MAX_DIFF_BYTES = 256 * 1024;
const SAFE_GIT_PATHSPECS = [
  ".",
  ":(exclude).env",
  ":(exclude).env.*",
  ":(exclude)**/.env",
  ":(exclude)**/.env.*",
  ":(exclude)**/*.pem",
  ":(exclude)**/*.key",
  ":(exclude)**/*.p12",
  ":(exclude)**/*.pfx",
  ":(exclude)**/*.jks",
  ":(exclude)**/*secret*",
  ":(exclude)**/*credential*",
  ":(exclude)node_modules/**",
  ":(exclude).next/**",
  ":(exclude)dist/**",
  ":(exclude)build/**",
  ":(exclude)coverage/**",
  ":(exclude)target/**",
];

export type CommitEvidence = {
  sha: string;
  shortSha: string;
  author: string;
  authoredAt: string;
  subject: string;
  body: string;
};

export type ChangedFileEvidence = {
  path: string;
  previousPath?: string;
  status: string;
  additions: number;
  deletions: number;
  binary: boolean;
};

export type GitRangeInput = {
  requestedRange?: string;
  base?: string;
  head?: string;
  since?: string;
  until?: string;
  maxCommits?: number;
};

function localDateTime(date: Date) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export function inferNaturalGitRange(
  requestedRange: string,
  now = new Date()
): Pick<GitRangeInput, "base" | "head" | "since" | "until"> {
  const text = requestedRange.trim();
  const revision = text.match(
    /(?:根据|从)?\s*([A-Za-z0-9_.-]*\d[A-Za-z0-9_.-]*)\s*(?:到|至|~|～|→|\.\.)\s*([A-Za-z0-9_.-]*\d[A-Za-z0-9_.-]*)/i
  );
  if (revision) return { base: revision[1], head: revision[2] };
  const explicitDates = text.match(
    /(\d{4}-\d{1,2}-\d{1,2})\s*(?:到|至|~|～|→)\s*(\d{4}-\d{1,2}-\d{1,2})/
  );
  if (explicitDates) {
    return {
      since: `${explicitDates[1]}T00:00:00`,
      until: `${explicitDates[2]}T23:59:59`,
    };
  }
  const recent = text.match(/(?:最近|过去)\s*(\d+|一|两|二|三|四)\s*(天|日|周|星期|个月|月)/);
  if (recent) {
    const countMap: Record<string, number> = {
      一: 1,
      两: 2,
      二: 2,
      三: 3,
      四: 4,
    };
    const count = Number(recent[1]) || countMap[recent[1]] || 1;
    const days =
      recent[2] === "周" || recent[2] === "星期"
        ? count * 7
        : recent[2] === "个月" || recent[2] === "月"
          ? count * 30
          : count;
    const since = new Date(now);
    since.setDate(since.getDate() - days);
    return { since: localDateTime(since), until: localDateTime(now) };
  }
  if (/本周/.test(text)) {
    const since = new Date(now);
    const weekday = (since.getDay() + 6) % 7;
    since.setDate(since.getDate() - weekday);
    since.setHours(0, 0, 0, 0);
    return { since: localDateTime(since), until: localDateTime(now) };
  }
  if (/本月/.test(text)) {
    const since = new Date(now.getFullYear(), now.getMonth(), 1);
    return { since: localDateTime(since), until: localDateTime(now) };
  }
  return {};
}

function gitEnv() {
  return {
    ...process.env,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_TERMINAL_PROMPT: "0",
  };
}

async function runGit(project: AgentProjectConfig, args: string[], timeout = 30_000) {
  const root = await resolveProjectRoot(project);
  const { stdout } = await execFileAsync(
    "git",
    [
      "-c",
      "core.hooksPath=/dev/null",
      "-c",
      "diff.external=",
      "-c",
      "diff.textconv=",
      ...args,
    ],
    {
      cwd: root,
      env: gitEnv(),
      timeout,
      maxBuffer: 16 * 1024 * 1024,
    }
  );
  return stdout;
}

function safeRevision(value: string) {
  if (!/^[A-Za-z0-9_./~^{}@+-]{1,200}$/.test(value)) {
    throw new Error("Git 版本标识包含不允许的字符。");
  }
  if (value.startsWith("-") || value.includes("..")) {
    throw new Error("Git 版本标识无效。");
  }
  return value;
}

async function resolveRevision(project: AgentProjectConfig, revision: string) {
  const output = await runGit(project, [
    "rev-parse",
    "--verify",
    `${safeRevision(revision)}^{commit}`,
  ]);
  return output.trim();
}

export async function resolveGitRange(
  project: AgentProjectConfig,
  input: GitRangeInput
) {
  const inferred =
    !input.base && !input.head && !input.since && !input.until && input.requestedRange
      ? inferNaturalGitRange(input.requestedRange)
      : {};
  const normalized = { ...input, ...inferred };
  const head = await resolveRevision(project, normalized.head || "HEAD");
  if (normalized.base) {
    return {
      requestedRange:
        input.requestedRange ||
        `${normalized.base}..${normalized.head || "HEAD"}`,
      baseCommit: await resolveRevision(project, normalized.base),
      headCommit: head,
      since: normalized.since,
      until: normalized.until,
    };
  }
  if (normalized.since || normalized.until) {
    const args = ["rev-list", "--reverse"];
    if (normalized.since) args.push(`--since=${normalized.since}`);
    if (normalized.until) args.push(`--until=${normalized.until}`);
    args.push(head);
    const commits = (await runGit(project, args))
      .split("\n")
      .filter(Boolean)
      .slice(0, Math.min(MAX_COMMITS, input.maxCommits ?? MAX_COMMITS));
    if (!commits.length) throw new Error("指定时间范围内没有找到提交。");
    const first = commits[0];
    const parent = await runGit(project, ["rev-parse", "--verify", `${first}^`])
      .then((value) => value.trim())
      .catch(() => first);
    return {
      requestedRange:
        `${input.requestedRange ? `${input.requestedRange} · ` : ""}${normalized.since || "最早"} 至 ${normalized.until || "现在"}`,
      baseCommit: parent,
      headCommit: commits.at(-1)!,
      since: normalized.since,
      until: normalized.until,
    };
  }
  const baseCommit = await runGit(project, ["rev-parse", "--verify", `${head}~20`])
    .then((value) => value.trim())
    .catch(async () => {
      const oldest = await runGit(project, [
        "rev-list",
        "--max-count=20",
        head,
      ]);
      return oldest.split("\n").filter(Boolean).at(-1) || head;
    });
  return {
    requestedRange: input.requestedRange || "最近 20 个提交",
    baseCommit,
    headCommit: head,
    since: normalized.since,
    until: normalized.until,
  };
}

export async function readGitLog(
  project: AgentProjectConfig,
  range: { baseCommit: string; headCommit: string; maxCommits?: number }
) {
  const limit = Math.min(MAX_COMMITS, Math.max(1, range.maxCommits ?? 50));
  const separator = "\u001f";
  const record = "\u001e";
  const stdout = await runGit(project, [
    "log",
    "--no-decorate",
    `--max-count=${limit}`,
    `--format=%H${separator}%h${separator}%an${separator}%aI${separator}%s${separator}%b${record}`,
    `${safeRevision(range.baseCommit)}..${safeRevision(range.headCommit)}`,
  ]);
  const commits = stdout
    .split(record)
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const [sha, shortSha, author, authoredAt, subject, body = ""] =
        item.split(separator);
      return { sha, shortSha, author, authoredAt, subject, body: body.trim() };
    });
  return { commits, truncated: commits.length >= limit };
}

export async function readGitDiffSummary(
  project: AgentProjectConfig,
  range: { baseCommit: string; headCommit: string }
) {
  const revision = `${safeRevision(range.baseCommit)}..${safeRevision(range.headCommit)}`;
  const [statusText, numstatText] = await Promise.all([
    runGit(project, [
      "diff",
      "--no-ext-diff",
      "--no-textconv",
      "--find-renames",
      "--name-status",
      revision,
      "--",
      ...SAFE_GIT_PATHSPECS,
    ]),
    runGit(project, [
      "diff",
      "--no-ext-diff",
      "--no-textconv",
      "--numstat",
      revision,
      "--",
      ...SAFE_GIT_PATHSPECS,
    ]),
  ]);
  const stats = new Map<
    string,
    { additions: number; deletions: number; binary: boolean }
  >();
  for (const line of numstatText.split("\n").filter(Boolean)) {
    const [added, deleted, ...pathParts] = line.split("\t");
    const pathname = pathParts.at(-1) ?? "";
    stats.set(pathname, {
      additions: added === "-" ? 0 : Number(added) || 0,
      deletions: deleted === "-" ? 0 : Number(deleted) || 0,
      binary: added === "-" || deleted === "-",
    });
  }
  const changedFiles = statusText
    .split("\n")
    .filter(Boolean)
    .map((line): ChangedFileEvidence | null => {
      const [status, first, second] = line.split("\t");
      const pathname = second || first;
      if (!pathname || isBlockedRelativePath(pathname)) return null;
      const stat = stats.get(pathname) ?? {
        additions: 0,
        deletions: 0,
        binary: false,
      };
      return {
        path: pathname,
        ...(second ? { previousPath: first } : {}),
        status,
        ...stat,
      };
    })
    .filter((item): item is ChangedFileEvidence => Boolean(item))
    .slice(0, MAX_CHANGED_FILES);
  return {
    changedFiles,
    truncated:
      statusText.split("\n").filter(Boolean).length > changedFiles.length,
  };
}

export async function readGitDiff(
  project: AgentProjectConfig,
  input: {
    baseCommit: string;
    headCommit: string;
    file?: string;
    contextLines?: number;
  }
) {
  if (input.file && (path.isAbsolute(input.file) || isBlockedRelativePath(input.file))) {
    throw new Error("该文件不允许读取 Diff。");
  }
  const args = [
    "diff",
    "--no-ext-diff",
    "--no-textconv",
    "--find-renames",
    `--unified=${Math.min(20, Math.max(0, input.contextLines ?? 3))}`,
    `${safeRevision(input.baseCommit)}..${safeRevision(input.headCommit)}`,
    "--",
    ...(input.file ? [input.file] : SAFE_GIT_PATHSPECS),
  ];
  const output = await runGit(project, args);
  const bounded = output.slice(0, MAX_DIFF_BYTES);
  return {
    diff: bounded,
    truncated: output.length > bounded.length,
    bytes: Buffer.byteLength(bounded),
  };
}
