import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { prisma } from "@/lib/db";
import { cacheDir } from "@/lib/paths";
import {
  AGENT_CONFIG_KEY,
  type AgentConfig,
  type AgentProjectConfig,
  parseAgentConfig,
} from "@/lib/ai/agent-config";

const execFileAsync = promisify(execFile);
const LOCAL_PATH_PATTERN =
  /(?:^|[\s（(：:，“"'])(\/(?:Users|home|Volumes|opt|srv|workspace|workspaces|data|private|tmp)\/[^\s，。；;！!？?"'）)]+)/u;
const GITHUB_URL_PATTERN =
  /https?:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?(?:\/(tree|commit|pull)\/([^/?#\s]+))?(?:[/?#\s]|$)/i;
const OWNER_REPO_PATTERN =
  /(?:^|[\s（(：:，“"'])@?([A-Za-z0-9][A-Za-z0-9_.-]{0,38})\/([A-Za-z0-9_.-]{1,100})(?:[\s，。；;！!？?"'）)]|$)/u;
const QUOTED_LOCAL_PATH_PATTERN = /["'](\/[^"'\n]+)["']/u;
const BLOCKED_LOCAL_ROOTS = [
  "/",
  "/System",
  "/Library",
  "/Applications",
  "/bin",
  "/sbin",
  "/usr",
  "/etc",
  "/var",
  "/dev",
  "/proc",
  "/sys",
];
const BLOCKED_HOME_CHILDREN = new Set([
  ".ssh",
  ".aws",
  ".gnupg",
  ".kube",
  ".docker",
  "Library/Keychains",
]);

export type CodeSourceCandidate =
  | {
      kind: "local-path";
      locator: string;
      root: string;
      displayName: string;
    }
  | {
      kind: "github-repository";
      locator: string;
      owner: string;
      repo: string;
      ref?: string;
      selectorKind?: "tree" | "commit" | "pull";
      displayName: string;
    }
  | {
      kind: "configured-project";
      locator: string;
      projectId: string;
      root: string;
      displayName: string;
    };

export type CodeSourceReference = {
  id: string;
  kind: "local" | "github" | "configured";
  sourceKey: string;
  displayName: string;
  locator: string;
  root: string;
  owner?: string;
  repo?: string;
  ref?: string;
  scope: "session" | "trusted";
  status: "pending" | "approved" | "rejected" | "revoked";
};

function cleanLocator(value: string) {
  return value.replace(/[，。；;！!？?"'）)]+$/u, "");
}

export function extractCodeSourceCandidate(
  message: string,
  projects: AgentProjectConfig[] = []
): CodeSourceCandidate | null {
  const local =
    message.match(QUOTED_LOCAL_PATH_PATTERN)?.[1] ??
    message.match(LOCAL_PATH_PATTERN)?.[1];
  if (local) {
    const root = cleanLocator(local);
    return {
      kind: "local-path",
      locator: root,
      root,
      displayName: path.basename(root) || root,
    };
  }

  const github = message.match(GITHUB_URL_PATTERN);
  if (github) {
    const repo = github[2].replace(/\.git$/i, "");
    return {
      kind: "github-repository",
      locator: `https://github.com/${github[1]}/${repo}`,
      owner: github[1],
      repo,
      ...(github[4]
        ? {
            ref:
              github[3] === "pull"
                ? `pull/${github[4]}/head`
                : github[4],
          }
        : {}),
      ...(github[3]
        ? { selectorKind: github[3] as "tree" | "commit" | "pull" }
        : {}),
      displayName: `${github[1]}/${repo}`,
    };
  }

  const ownerRepo = message.match(OWNER_REPO_PATTERN);
  if (
    ownerRepo &&
    (/github|开源仓库|远程仓库/i.test(message) ||
      message.trim().toLowerCase() ===
        `${ownerRepo[1]}/${ownerRepo[2]}`.toLowerCase())
  ) {
    return {
      kind: "github-repository",
      locator: `https://github.com/${ownerRepo[1]}/${ownerRepo[2]}`,
      owner: ownerRepo[1],
      repo: ownerRepo[2].replace(/\.git$/i, ""),
      displayName: `${ownerRepo[1]}/${ownerRepo[2].replace(/\.git$/i, "")}`,
    };
  }

  const lower = message.toLowerCase();
  const matches = projects.filter((project) => {
    const basename = path.basename(project.root);
    return [project.id, project.name, basename].some(
      (value) => value && lower.includes(value.toLowerCase())
    );
  });
  if (matches.length === 1) {
    return {
      kind: "configured-project",
      locator: matches[0].root,
      projectId: matches[0].id,
      root: matches[0].root,
      displayName: matches[0].name,
    };
  }
  return null;
}

export async function validateLocalCodeSource(rootInput: string) {
  if (!path.isAbsolute(rootInput)) throw new Error("项目路径必须是绝对路径。");
  const root = await fs.realpath(rootInput);
  const stat = await fs.stat(root);
  if (!stat.isDirectory()) throw new Error("项目路径不是目录。");
  const normalized = path.resolve(root);
  if (
    BLOCKED_LOCAL_ROOTS.some(
      (blocked) =>
        normalized === blocked ||
        (blocked !== "/" && normalized.startsWith(`${blocked}${path.sep}`))
    )
  ) {
    throw new Error("该系统目录不能作为代码探索项目。");
  }
  const home = os.homedir();
  if (normalized === home) throw new Error("不能授权读取整个用户主目录。");
  const relativeHome = path.relative(home, normalized).replaceAll(path.sep, "/");
  if (
    !relativeHome.startsWith("..") &&
    [...BLOCKED_HOME_CHILDREN].some(
      (item) => relativeHome === item || relativeHome.startsWith(`${item}/`)
    )
  ) {
    throw new Error("该目录可能包含凭证或密钥，不能授权。");
  }
  return normalized;
}

/**
 * 从 LLM 抽出的 locator 字符串构造 CodeSourceCandidate，作为正则识别失败时的兜底。
 * - GitHub 地址：复用 GITHUB_URL_PATTERN 解析。
 * - 本地绝对路径：走 validateLocalCodeSource 严格校验（拒绝不存在/系统目录/凭证目录/整个 home）。
 *
 * 校验失败一律返回 null（不抛错），让上层继续走已配置项目兜底，而非中断流程。
 * local-path 首次仍需用户 approval（人在回路），由 createOrReuseCodeSourceGrant 处理。
 */
export async function buildCandidateFromLocator(
  locator: string
): Promise<CodeSourceCandidate | null> {
  const trimmed = locator.trim();
  if (!trimmed) return null;

  const github = trimmed.match(GITHUB_URL_PATTERN);
  if (github) {
    const repo = github[2].replace(/\.git$/i, "");
    return {
      kind: "github-repository",
      locator: `https://github.com/${github[1]}/${repo}`,
      owner: github[1],
      repo,
      ...(github[4]
        ? {
            ref:
              github[3] === "pull" ? `pull/${github[4]}/head` : github[4],
          }
        : {}),
      ...(github[3]
        ? { selectorKind: github[3] as "tree" | "commit" | "pull" }
        : {}),
      displayName: `${github[1]}/${repo}`,
    };
  }

  if (path.isAbsolute(trimmed)) {
    try {
      const validated = await validateLocalCodeSource(trimmed);
      return {
        kind: "local-path",
        locator: validated,
        root: validated,
        displayName: path.basename(validated) || validated,
      };
    } catch {
      return null;
    }
  }

  return null;
}

export function codeSourceKey(candidate: CodeSourceCandidate) {
  const stable =
    candidate.kind === "github-repository"
      ? `github:${candidate.owner.toLowerCase()}/${candidate.repo.toLowerCase()}:${candidate.ref ?? "default"}`
      : `${candidate.kind}:${path.resolve(candidate.root)}`;
  return crypto.createHash("sha256").update(stable).digest("hex");
}

function hashToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export async function createOrReuseCodeSourceGrant(input: {
  sessionId: string;
  candidate: CodeSourceCandidate;
}) {
  const validatedRoot =
    input.candidate.kind === "local-path"
      ? await validateLocalCodeSource(input.candidate.root)
      : null;
  const candidate = validatedRoot
    ? {
        ...input.candidate,
        root: validatedRoot,
        locator: validatedRoot,
      }
    : input.candidate;
  const sourceKey = codeSourceKey(candidate);
  const existing = await prisma.codeSourceGrant.findUnique({
    where: { sessionId_sourceKey: { sessionId: input.sessionId, sourceKey } },
  });
  if (existing?.status === "approved") {
    await prisma.codeSourceGrant.update({
      where: { id: existing.id },
      data: { lastAccessedAt: new Date() },
    });
    return { grant: existing, approvalToken: null };
  }
  const kind =
    candidate.kind === "github-repository"
      ? "github"
      : candidate.kind === "configured-project"
        ? "configured"
        : "local";
  const automaticallyApproved = kind === "github" || kind === "configured";

  // 已有 pending grant：只刷新元数据，绝不轮换 approvalTokenHash。
  // 否则客户端消息里保存的旧 token 会立刻失效（「代码源授权令牌无效」）。
  if (existing?.status === "pending") {
    const grant = await prisma.codeSourceGrant.update({
      where: { id: existing.id },
      data: {
        kind,
        displayName: candidate.displayName,
        locator: candidate.locator,
        root: "root" in candidate ? candidate.root : existing.root,
        owner: "owner" in candidate ? candidate.owner : existing.owner,
        repo: "repo" in candidate ? candidate.repo : existing.repo,
        ref: "ref" in candidate ? (candidate.ref ?? null) : existing.ref,
        lastAccessedAt: new Date(),
      },
    });
    return { grant, approvalToken: null };
  }

  const approvalToken = crypto.randomBytes(24).toString("base64url");
  const grant = await prisma.codeSourceGrant.upsert({
    where: { sessionId_sourceKey: { sessionId: input.sessionId, sourceKey } },
    update: {
      kind,
      displayName: candidate.displayName,
      locator: candidate.locator,
      root: "root" in candidate ? candidate.root : null,
      owner: "owner" in candidate ? candidate.owner : null,
      repo: "repo" in candidate ? candidate.repo : null,
      ref: "ref" in candidate ? candidate.ref ?? null : null,
      status: automaticallyApproved ? "approved" : "pending",
      approvalTokenHash: automaticallyApproved ? null : hashToken(approvalToken),
      approvedAt: automaticallyApproved ? new Date() : null,
      lastAccessedAt: automaticallyApproved ? new Date() : null,
    },
    create: {
      sessionId: input.sessionId,
      sourceKey,
      kind,
      displayName: candidate.displayName,
      locator: candidate.locator,
      root: "root" in candidate ? candidate.root : null,
      owner: "owner" in candidate ? candidate.owner : null,
      repo: "repo" in candidate ? candidate.repo : null,
      ref: "ref" in candidate ? candidate.ref ?? null : null,
      status: automaticallyApproved ? "approved" : "pending",
      approvalTokenHash: automaticallyApproved ? null : hashToken(approvalToken),
      approvedAt: automaticallyApproved ? new Date() : null,
      lastAccessedAt: automaticallyApproved ? new Date() : null,
    },
  });
  return { grant, approvalToken: automaticallyApproved ? null : approvalToken };
}

export async function approveCodeSourceGrant(input: {
  id: string;
  approvalToken: string;
  scope: "session" | "trusted";
}) {
  const grant = await prisma.codeSourceGrant.findUnique({ where: { id: input.id } });
  if (!grant || grant.status !== "pending") throw new Error("该代码源授权已失效。");
  if (
    !grant.approvalTokenHash ||
    hashToken(input.approvalToken) !== grant.approvalTokenHash
  ) {
    throw new Error("代码源授权令牌无效。");
  }
  if (!grant.root) throw new Error("本地项目路径无效。");
  const root = await validateLocalCodeSource(grant.root);
  if (input.scope === "trusted") await addTrustedProject(grant.displayName, root);
  return prisma.codeSourceGrant.update({
    where: { id: grant.id },
    data: {
      root,
      locator: root,
      scope: input.scope,
      status: "approved",
      approvalTokenHash: null,
      approvedAt: new Date(),
      lastAccessedAt: new Date(),
    },
  });
}

async function addTrustedProject(name: string, root: string) {
  const row = await prisma.systemConfig.findUnique({
    where: { key: AGENT_CONFIG_KEY },
  });
  const config = parseAgentConfig(row?.value);
  if (config.projects.some((project) => path.resolve(project.root) === root)) return;
  const baseId =
    path.basename(root).toLowerCase().replace(/[^a-z0-9_-]+/g, "-") || "project";
  let id = baseId;
  let suffix = 2;
  while (config.projects.some((project) => project.id === id)) {
    id = `${baseId}-${suffix++}`;
  }
  const next = { ...config, projects: [...config.projects, { id, name, root }] };
  await prisma.systemConfig.upsert({
    where: { key: AGENT_CONFIG_KEY },
    update: { value: JSON.stringify(next, null, 2) },
    create: { key: AGENT_CONFIG_KEY, value: JSON.stringify(next, null, 2) },
  });
}

export async function githubRequest(
  pathname: string,
  config: AgentConfig
): Promise<unknown> {
  const response = await fetch(`https://api.github.com${pathname}`, {
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "InkPress-CodeExplorer",
      ...(config.githubToken
        ? { Authorization: `Bearer ${config.githubToken}` }
        : {}),
    },
    signal: AbortSignal.timeout(20_000),
  });
  const text = await response.text();
  if (text.length > 8 * 1024 * 1024) {
    throw new Error("GitHub 返回内容过大，已停止读取。");
  }
  const data = JSON.parse(text || "{}") as unknown;
  const record =
    data && typeof data === "object" && !Array.isArray(data)
      ? (data as Record<string, unknown>)
      : {};
  if (!response.ok) {
    if (response.status === 404) {
      throw new Error("GitHub 仓库不存在、不是公开仓库，或当前令牌无权访问。");
    }
    if (response.status === 403 || response.status === 429) {
      throw new Error("GitHub API 访问受限，请稍后重试或配置 GitHub Token。");
    }
    throw new Error(
      typeof record.message === "string"
        ? `GitHub：${record.message}`
        : `GitHub 请求失败（${response.status}）。`
    );
  }
  return data;
}

export async function fetchGithubPullRequest(input: {
  owner: string;
  repo: string;
  pullNumber: number;
  config: AgentConfig;
}) {
  const base = `/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/pulls/${input.pullNumber}`;
  const [pull, commits, files] = await Promise.all([
    githubRequest(base, input.config),
    githubRequest(`${base}/commits?per_page=100`, input.config),
    githubRequest(`${base}/files?per_page=100`, input.config),
  ]);
  const pullRecord =
    pull && typeof pull === "object" && !Array.isArray(pull)
      ? (pull as Record<string, unknown>)
      : {};
  const commitList = Array.isArray(commits)
    ? commits.slice(0, 100).map((item) => {
        const value = item as Record<string, unknown>;
        const commit =
          value.commit && typeof value.commit === "object"
            ? (value.commit as Record<string, unknown>)
            : {};
        return {
          sha: value.sha,
          htmlUrl: value.html_url,
          message:
            typeof commit.message === "string"
              ? commit.message.slice(0, 2000)
              : "",
        };
      })
    : [];
  const fileList = Array.isArray(files)
    ? files.slice(0, 100).map((item) => {
        const value = item as Record<string, unknown>;
        return {
          filename: value.filename,
          previousFilename: value.previous_filename,
          status: value.status,
          additions: value.additions,
          deletions: value.deletions,
          changes: value.changes,
          patch:
            typeof value.patch === "string" ? value.patch.slice(0, 8000) : "",
        };
      })
    : [];
  return {
    pull: {
      number: pullRecord.number,
      title: pullRecord.title,
      state: pullRecord.state,
      htmlUrl: pullRecord.html_url,
      body:
        typeof pullRecord.body === "string"
          ? pullRecord.body.slice(0, 8000)
          : "",
      base: pullRecord.base,
      head: pullRecord.head,
      mergedAt: pullRecord.merged_at,
    },
    commits: commitList,
    files: fileList,
    truncated:
      (Array.isArray(commits) && commits.length > commitList.length) ||
      (Array.isArray(files) && files.length > fileList.length),
  };
}

function safeGitEnv() {
  return {
    ...process.env,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_TERMINAL_PROMPT: "0",
  };
}

async function runGit(args: string[], cwd?: string, timeout = 60_000) {
  return execFileAsync(
    "git",
    [
      "-c",
      "core.hooksPath=/dev/null",
      "-c",
      "diff.external=",
      "-c",
      "filter.lfs.smudge=",
      "-c",
      "filter.lfs.required=false",
      ...args,
    ],
    {
      cwd,
      env: safeGitEnv(),
      timeout,
      maxBuffer: 16 * 1024 * 1024,
    }
  );
}

export async function ensureGithubCodeSource(
  grantId: string,
  config: AgentConfig,
  historyDepth = 1
) {
  const grant = await prisma.codeSourceGrant.findUnique({ where: { id: grantId } });
  if (
    !grant ||
    grant.status !== "approved" ||
    grant.kind !== "github" ||
    !grant.owner ||
    !grant.repo
  ) {
    throw new Error("GitHub 代码源无效或尚未授权。");
  }
  const metadata = await githubRequest(
    `/repos/${encodeURIComponent(grant.owner)}/${encodeURIComponent(grant.repo)}`,
    config
  );
  const metadataRecord = metadata as Record<string, unknown>;
  if (metadataRecord.private === true) throw new Error("首版仅支持 GitHub 公开仓库。");
  const defaultBranch =
    typeof metadataRecord.default_branch === "string"
      ? metadataRecord.default_branch
      : "main";
  const ref = grant.ref || defaultBranch;
  const cacheRoot = path.join(
    cacheDir(),
    "github",
    grant.owner.toLowerCase(),
    grant.repo.toLowerCase(),
    crypto.createHash("sha1").update(ref).digest("hex").slice(0, 12)
  );
  const gitDirectory = path.join(cacheRoot, ".git");
  const exists = await fs.stat(gitDirectory).then(() => true).catch(() => false);
  await fs.mkdir(path.dirname(cacheRoot), { recursive: true });
  if (!exists) {
    const url = `https://github.com/${grant.owner}/${grant.repo}.git`;
    await runGit(
      [
        "clone",
        "--depth",
        String(Math.min(1000, Math.max(1, historyDepth))),
        "--filter=blob:none",
        "--single-branch",
        "--branch",
        ref,
        "--",
        url,
        cacheRoot,
      ],
      undefined,
      120_000
    ).catch(async () => {
      await fs.rm(cacheRoot, { recursive: true, force: true });
      await runGit(
        [
          "clone",
          "--depth",
          String(Math.min(1000, Math.max(1, historyDepth))),
          "--filter=blob:none",
          "--",
          url,
          cacheRoot,
        ],
        undefined,
        120_000
      );
      if (grant.ref) {
        await runGit(
          [
            "fetch",
            "--depth",
            String(Math.min(1000, Math.max(1, historyDepth))),
            "origin",
            grant.ref,
          ],
          cacheRoot
        );
        await runGit(["checkout", "--detach", "FETCH_HEAD"], cacheRoot);
      }
    });
  } else {
    await runGit(
      [
        "fetch",
        historyDepth > 1 ? `--deepen=${Math.min(1000, historyDepth)}` : "--depth=1",
        "origin",
        ref,
      ],
      cacheRoot
    ).catch(() => undefined);
  }
  const { stdout } = await runGit(["rev-parse", "HEAD"], cacheRoot);
  await prisma.codeSourceGrant.update({
    where: { id: grant.id },
    data: {
      ref,
      cacheRoot,
      root: cacheRoot,
      lastAccessedAt: new Date(),
    },
  });
  return { root: cacheRoot, ref, commit: stdout.trim(), metadata: metadataRecord };
}

export async function codeSourceProject(
  grantId: string,
  config: AgentConfig,
  options: { historyDepth?: number } = {}
): Promise<{ project: AgentProjectConfig; source: CodeSourceReference }> {
  let grant = await prisma.codeSourceGrant.findUnique({ where: { id: grantId } });
  if (!grant || grant.status !== "approved") {
    throw new Error("代码源尚未授权或已经失效。");
  }
  if (grant.kind === "github") {
    await ensureGithubCodeSource(
      grant.id,
      config,
      options.historyDepth ?? 1
    );
    grant = await prisma.codeSourceGrant.findUnique({ where: { id: grant.id } });
  }
  if (!grant?.root) throw new Error("代码源没有可读取的本地快照。");
  const root =
    grant.kind === "local" || grant.kind === "configured"
      ? await validateLocalCodeSource(grant.root)
      : grant.root;
  return {
    project: { id: `source-${grant.id}`, name: grant.displayName, root },
    source: {
      id: grant.id,
      kind: grant.kind as CodeSourceReference["kind"],
      sourceKey: grant.sourceKey,
      displayName: grant.displayName,
      locator: grant.locator,
      root,
      ...(grant.owner ? { owner: grant.owner } : {}),
      ...(grant.repo ? { repo: grant.repo } : {}),
      ...(grant.ref ? { ref: grant.ref } : {}),
      scope: grant.scope as CodeSourceReference["scope"],
      status: grant.status as CodeSourceReference["status"],
    },
  };
}

export async function revokeCodeSourceGrant(id: string) {
  return prisma.codeSourceGrant.updateMany({
    where: { id, status: { in: ["pending", "approved"] } },
    data: { status: "revoked", approvalTokenHash: null },
  });
}

export async function rejectCodeSourceGrant(input: {
  id: string;
  approvalToken: string;
}) {
  const grant = await prisma.codeSourceGrant.findUnique({ where: { id: input.id } });
  if (!grant || grant.status !== "pending") return null;
  if (
    !grant.approvalTokenHash ||
    hashToken(input.approvalToken) !== grant.approvalTokenHash
  ) {
    throw new Error("代码源授权令牌无效。");
  }
  return prisma.codeSourceGrant.update({
    where: { id: grant.id },
    data: { status: "rejected", approvalTokenHash: null },
  });
}

/**
 * 为仍处 pending 的 grant 签发新 approvalToken（仅当客户端 token 已失效时调用）。
 * 会轮换 approvalTokenHash；调用方须用返回的新 token 重试 approve。
 */
export async function refreshCodeSourceApprovalToken(id: string) {
  const grant = await prisma.codeSourceGrant.findUnique({ where: { id } });
  if (!grant || grant.status !== "pending") {
    throw new Error("该代码源授权已失效。");
  }
  const approvalToken = crypto.randomBytes(24).toString("base64url");
  const updated = await prisma.codeSourceGrant.update({
    where: { id },
    data: { approvalTokenHash: hashToken(approvalToken) },
  });
  return { grant: updated, approvalToken };
}
