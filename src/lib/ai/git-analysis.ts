import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { ToolLoopAgent, stepCountIs, tool, type LanguageModel } from "ai";
import { z } from "zod";
import type {
  CallFlow,
  SourceEvidence,
  SymbolEvidence,
} from "@/lib/ai/code-evidence";
import type { CodeSourceReference } from "@/lib/ai/code-source";
import type { AgentProjectConfig } from "@/lib/ai/agent-config";
import { isBlockedRelativePath, resolveProjectRoot } from "@/lib/ai/project-access";
import { getProjectIndex } from "@/lib/ai/project-index";

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

export type ChangeFeatureGroup = {
  name: string;
  summary: string;
  commits: string[];
  files: string[];
  evidence: SourceEvidence[];
};

export type CodeChangeEvidencePackage = {
  source: CodeSourceReference;
  baseCommit: string;
  headCommit: string;
  requestedRange: string;
  commits: CommitEvidence[];
  changedFiles: ChangedFileEvidence[];
  featureGroups: ChangeFeatureGroup[];
  relatedSymbols: SymbolEvidence[];
  implementationFlows: CallFlow[];
  risks: string[];
  openQuestions: string[];
  truncated: boolean;
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

export async function showGitCommit(
  project: AgentProjectConfig,
  input: { commit: string; includePatch?: boolean }
) {
  const commit = await resolveRevision(project, input.commit);
  const format = "%H%n%h%n%an%n%aI%n%s%n%b";
  const metadata = await runGit(project, [
    "show",
    "--quiet",
    `--format=${format}`,
    commit,
  ]);
  const patch = input.includePatch
    ? await runGit(project, [
        "show",
        "--no-ext-diff",
        "--no-textconv",
        "--format=",
        "--find-renames",
        "--unified=3",
        commit,
        "--",
        ...SAFE_GIT_PATHSPECS,
      ])
    : "";
  return {
    commit,
    metadata: metadata.trim(),
    patch: patch.slice(0, MAX_DIFF_BYTES),
    truncated: patch.length > MAX_DIFF_BYTES,
  };
}

function fallbackFeatureGroups(
  commits: CommitEvidence[],
  files: ChangedFileEvidence[]
): ChangeFeatureGroup[] {
  const groups = new Map<string, ChangedFileEvidence[]>();
  for (const file of files) {
    const segment = file.path.split("/")[0] || "root";
    groups.set(segment, [...(groups.get(segment) ?? []), file]);
  }
  return [...groups.entries()].slice(0, 12).map(([name, items]) => ({
    name,
    summary: `${items.length} 个文件发生变更`,
    commits: commits.map((commit) => commit.sha).slice(0, 10),
    files: items.map((item) => item.path),
    evidence: items.slice(0, 8).map((item) => ({
      path: item.path,
      startLine: 1,
      endLine: 1,
      summary: `${item.status}，+${item.additions}/-${item.deletions}`,
    })),
  }));
}

function extractJson(text: string) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const candidate = fenced ?? text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  return JSON.parse(candidate);
}

export async function analyzeCodeChangesWithAgent(input: {
  model: LanguageModel;
  project: AgentProjectConfig;
  source: CodeSourceReference;
  objective: string;
  range: GitRangeInput;
  maxSteps?: number;
  abortSignal?: AbortSignal;
  onStep?: (step: { title: string; detail: string }) => void | Promise<void>;
}): Promise<CodeChangeEvidencePackage> {
  const initialRange = await resolveGitRange(input.project, input.range);
  const tools = {
    git_resolve_range: tool({
      description: "将用户描述的版本或时间范围解析为固定 base/head Commit。",
      inputSchema: z.object({
        requestedRange: z.string().optional(),
        base: z.string().optional(),
        head: z.string().optional(),
        since: z.string().optional(),
        until: z.string().optional(),
      }),
      execute: (args) => resolveGitRange(input.project, args),
    }),
    git_log: tool({
      description: "读取固定 Commit 区间内的提交记录。",
      inputSchema: z.object({
        baseCommit: z.string(),
        headCommit: z.string(),
        maxCommits: z.number().int().min(1).max(MAX_COMMITS).optional(),
      }),
      execute: (args) => readGitLog(input.project, args),
    }),
    git_diff_summary: tool({
      description: "读取固定 Commit 区间的文件及增删统计。",
      inputSchema: z.object({
        baseCommit: z.string(),
        headCommit: z.string(),
      }),
      execute: (args) => readGitDiffSummary(input.project, args),
    }),
    git_diff_read: tool({
      description: "按需读取某个文件的受限统一 Diff。",
      inputSchema: z.object({
        baseCommit: z.string(),
        headCommit: z.string(),
        file: z.string().optional(),
        contextLines: z.number().int().min(0).max(20).optional(),
      }),
      execute: (args) => readGitDiff(input.project, args),
    }),
    git_show_commit: tool({
      description: "读取单个 Commit 的元数据及可选补丁。",
      inputSchema: z.object({
        commit: z.string(),
        includePatch: z.boolean().optional(),
      }),
      execute: (args) => showGitCommit(input.project, args),
    }),
  };
  const agent = new ToolLoopAgent({
    id: "inkpress-code-change-analyzer",
    model: input.model,
    tools,
    temperature: 0.1,
    stopWhen: stepCountIs(Math.min(10, input.maxSteps ?? 8)),
    instructions: `你是严格只读的 Git 变更分析 Agent。只根据工具返回的 Commit、Diff 和文件证据总结，不执行项目代码，不把提交标题当作实现事实。
最终仅输出 JSON：
{"featureGroups":[{"name":"","summary":"","commits":[],"files":[],"evidence":[{"path":"","startLine":1,"endLine":1,"summary":""}]}],"risks":[],"openQuestions":[]}
每个功能组必须引用真实 Commit SHA 和真实文件。`,
    onStepFinish: async (event) => {
      await input.onStep?.({
        title: "分析 Git 变更",
        detail: `完成 ${event.toolCalls.length} 个工具调用`,
      });
    },
  });
  const [logResult, summaryResult, index] = await Promise.all([
    readGitLog(input.project, initialRange),
    readGitDiffSummary(input.project, initialRange),
    getProjectIndex(input.project).catch(() => null),
  ]);
  let featureGroups = fallbackFeatureGroups(
    logResult.commits,
    summaryResult.changedFiles
  );
  let risks: string[] = [];
  let openQuestions: string[] = [];
  try {
    const result = await agent.generate({
      prompt: `${input.objective}
已解析范围：${JSON.stringify(initialRange)}
请先读取提交与差异摘要，再对关键文件读取 Diff 并输出结构化功能分组。`,
      abortSignal: input.abortSignal,
    });
    const parsed = extractJson(result.text) as {
      featureGroups?: ChangeFeatureGroup[];
      risks?: string[];
      openQuestions?: string[];
    };
    if (Array.isArray(parsed.featureGroups) && parsed.featureGroups.length) {
      featureGroups = parsed.featureGroups;
    }
    risks = Array.isArray(parsed.risks) ? parsed.risks : [];
    openQuestions = Array.isArray(parsed.openQuestions)
      ? parsed.openQuestions
      : [];
  } catch {
    risks.push("模型未返回有效结构化分组，已按目录生成确定性变更分组。");
  }
  const changedPaths = new Set(summaryResult.changedFiles.map((file) => file.path));
  const relatedSymbols =
    index?.symbols.filter((symbol) => changedPaths.has(symbol.path)).slice(0, 300) ??
    [];
  return {
    source: input.source,
    baseCommit: initialRange.baseCommit,
    headCommit: initialRange.headCommit,
    requestedRange: initialRange.requestedRange,
    commits: logResult.commits,
    changedFiles: summaryResult.changedFiles,
    featureGroups,
    relatedSymbols,
    implementationFlows: [],
    risks,
    openQuestions,
    truncated: logResult.truncated || summaryResult.truncated,
  };
}
