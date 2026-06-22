#!/usr/bin/env node
/**
 * InkPress 版本发布脚本（仓库级「发布技能」）。
 *
 * 流程：
 * 1. 解析最近 tag → HEAD 之间的 git 提交，按 Conventional Commits 分组。
 * 2. 据此判定版本号增量（major/minor/patch），支持 --patch/--minor/--major 强制覆盖。
 * 3. 生成 Markdown Release Notes，写入 annotated tag。
 * 4. 更新 package.json version，提交 chore(release) commit，打 tag。
 * 5. 可选 --push 自动推送 commit + tag（推送后 GitHub Actions 自动构建双架构 DMG）。
 *
 * 用法：
 *   pnpm release                 # 交互模式，默认 dry-run 预览
 *   pnpm release --dry-run       # 仅预览，不改动任何文件
 *   pnpm release --minor --push  # 强制 minor 增量并推送
 *   pnpm release --any-branch    # 允许在非 main 分支发版（默认拒绝，hotfix 用）
 *   pnpm release --allow-dirty   # 允许工作区有未提交改动（默认拒绝）
 *
 * 校验：
 * - 默认必须在 main 分支（避免 tag 指向偏离主干的提交）
 * - 默认必须工作区干净（避免把进行中的代码混入 release commit）
 * - tag 本地 + 远端去重校验（避免 push 时冲突）
 *
 * 纯 Node ESM，零运行时依赖。
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const ROOT = process.cwd();
const PKG_PATH = path.join(ROOT, "package.json");

// ---------- CLI 参数 ----------
const argv = process.argv.slice(2);
const dryRun = argv.includes("--dry-run");
const doPush = argv.includes("--push");
const forceLevel = argv.includes("--major")
  ? "major"
  : argv.includes("--minor")
    ? "minor"
    : argv.includes("--patch")
      ? "patch"
      : null;
const noConfirm = argv.includes("--yes") || argv.includes("-y");
// 默认仅允许在 main 分支发布；--any-branch 可绕过（用于 hotfix 等）
const allowAnyBranch = argv.includes("--any-branch");
// 默认要求工作区干净；--allow-dirty 允许在未提交改动上叠加 release commit
const allowDirty = argv.includes("--allow-dirty");

// ---------- 工具：git 封装 ----------
function git(args) {
  return execFileSync("git", args, {
    cwd: ROOT,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
}
function tryGit(args) {
  try {
    return git(args);
  } catch {
    return "";
  }
}

/** 读取工作区是否有未提交改动（用于提示，不强制阻断） */
function hasUncommittedChanges() {
  const status = git(["status", "--porcelain"]);
  return status.length > 0 ? status.split("\n") : [];
}

/** 获取最近一个 tag（无 tag 返回空） */
function lastTag() {
  return tryGit(["describe", "--tags", "--abbrev=0"]);
}

/** 收集从 fromRef（可空）到 HEAD 的提交 */
function collectCommits(fromRef) {
  const range = fromRef ? `${fromRef}..HEAD` : "HEAD";
  // 用 NUL(\x00) 作为记录分隔、单元分隔符(\x1f) 作为字段分隔，
  // 这样即使 commit body 含换行也不会错位（消息中不会出现这两个控制字符）。
  const raw = tryGit([
    "log",
    range,
    "--pretty=format:%H%x1f%s%x1f%b%x00",
    "--no-merges",
  ]);
  if (!raw) return [];
  return raw
    .split("\x00")
    .map((rec) => rec.trim())
    .filter(Boolean)
    .map((rec) => {
      const [hash, subject, ...bodyParts] = rec.split("\x1f");
      return {
        hash: hash ?? "",
        subject: (subject ?? "").trim(),
        body: (bodyParts.join("\x1f") ?? "").trim(),
      };
    });
}

// ---------- Conventional Commits 解析 ----------
const CC_RE =
  /^(?<type>feat|fix|perf|refactor|docs|style|test|build|ci|chore|revert)(?:\((?<scope>[^)]+)\))?(?<breaking>!)?:\s*(?<desc>.+)/i;

const GROUPS = [
  { type: "feat", icon: "✨", title: "新功能" },
  { type: "fix", icon: "🐛", title: "修复" },
  { type: "perf", icon: "⚡", title: "性能" },
  { type: "refactor", icon: "♻️", title: "重构" },
  { type: "docs", icon: "📝", title: "文档" },
  { type: "build", icon: "📦", title: "构建/依赖" },
  { type: "ci", icon: "👷", title: "CI" },
  { type: "test", icon: "✅", title: "测试" },
  { type: "revert", icon: "⏪", title: "回退" },
  { type: "chore", icon: "🔧", title: "杂项" },
  { type: "style", icon: "🎨", title: "样式" },
];

/**
 * 判定某条提交是否包含 breaking change。
 *
 * subject 内的 `!` 仅在 Conventional Commits 形式 `type(scope)!: desc` 时算 breaking，
 * 故此处只查 body 内的 BREAKING CHANGE 标记（subject 的 `!` 已由 classify 解析）。
 * 旧实现 `c.subject.includes("!")` 会把 `fix: 解决 issue!123` 之类普通文本误判。
 */
function isBreaking(c) {
  return /BREAKING[ -]CHANGE/i.test(c.body);
}

/** 解析一条提交，归入分组；带 breaking 标记则收集破坏性变更描述 */
function classify(c) {
  const m = CC_RE.exec(c.subject);
  if (!m) {
    return { group: "other", scope: null, desc: c.subject };
  }
  const { type, scope, breaking, desc } = m.groups;
  const scopeStr = scope ? `**${scope}**: ` : "";
  return {
    group: type.toLowerCase(),
    scope: scope ?? null,
    desc: `${scopeStr}${desc.trim()}`,
    breaking: Boolean(breaking) || isBreaking(c),
  };
}

/** 提取 breaking 变更的可读描述 */
function breakingDescription(c) {
  const bodyMatch = c.body.match(/BREAKING[ -]CHANGE:\s*(.+)/i);
  if (bodyMatch) return bodyMatch[1].trim();
  const m = CC_RE.exec(c.subject);
  if (m) {
    const { scope, desc } = m.groups;
    return `${scope ? `(${scope}) ` : ""}${desc.trim()}`;
  }
  return c.subject;
}

// ---------- 版本号计算 ----------
function bumpVersion(current, level) {
  const parts = current.split(".").map((n) => parseInt(n, 10));
  if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) {
    throw new Error(`非法版本号: ${current}`);
  }
  let [major, minor, patch] = parts;
  if (level === "major") {
    major += 1;
    minor = 0;
    patch = 0;
  } else if (level === "minor") {
    minor += 1;
    patch = 0;
  } else {
    patch += 1;
  }
  return `${major}.${minor}.${patch}`;
}

function pickLevel(items, breakingCount) {
  if (breakingCount > 0) return "major";
  if (items.some((i) => i.group === "feat")) return "minor";
  return "patch";
}

// ---------- Release Notes 生成 ----------
function buildNotes(newVersion, fromRef, classified) {
  const lines = [];
  lines.push(`## v${newVersion}`);
  lines.push("");

  const breaking = classified.filter((c) => c.breaking);
  if (breaking.length > 0) {
    lines.push("### ⚠️ 破坏性变更");
    lines.push("");
    for (const b of breaking) {
      lines.push(`- ${b.desc}`);
    }
    lines.push("");
  }

  for (const g of GROUPS) {
    const entries = classified.filter((c) => c.group === g.type);
    if (entries.length === 0) continue;
    lines.push(`### ${g.icon} ${g.title}`);
    lines.push("");
    for (const e of entries) {
      lines.push(`- ${e.desc}`);
    }
    lines.push("");
  }

  const others = classified.filter(
    (c) => c.group === "other" && !c.breaking
  );
  if (others.length > 0) {
    lines.push("### 📌 其他");
    lines.push("");
    for (const o of others) {
      lines.push(`- ${o.desc}`);
    }
    lines.push("");
  }

  const since = fromRef || "仓库起点";
  lines.push(`---`);
  lines.push(`_基于 \`${since}...v${newVersion}\` 期间的 ${classified.length} 条提交自动生成_`);

  return lines.join("\n");
}

// ---------- 主流程 ----------
async function main() {
  // 前置：分支校验。默认仅允许 main，避免在 feature 分支误发版导致 tag 指向偏离主干
  const currentBranch = git(["rev-parse", "--abbrev-ref", "HEAD"]);
  if (currentBranch !== "main" && !allowAnyBranch) {
    console.error(
      `✗ 当前分支为 ${currentBranch}，发布请在 main 分支执行。\n  若确需在当前分支 hotfix 发版，加 --any-branch 绕过该校验。`
    );
    process.exit(1);
  }

  // 前置：工作区校验。默认要求干净，避免把进行中的代码混入 release commit。
  const dirty = hasUncommittedChanges();
  if (dirty.length > 0 && !allowDirty) {
    console.error(
      `✗ 工作区有 ${dirty.length} 处未提交改动，请先 commit 或 stash。\n  若要叠加在当前改动上发版，加 --allow-dirty 绕过。`
    );
    process.exit(1);
  }
  if (dirty.length > 0) {
    console.warn(
      `⚠️  工作区有 ${dirty.length} 处未提交改动（已 --allow-dirty），将与 release commit 一起提交。`
    );
  }

  const from = lastTag();
  const commits = collectCommits(from);
  if (commits.length === 0) {
    console.log(
      from
        ? `✓ 自 ${from} 以来没有新提交，无需发布。`
        : `✓ 没有提交记录，无法生成 Release。`
    );
    process.exit(0);
  }

  const classified = commits.map(classify);
  const breakingCount = classified.filter((c) => c.breaking).length;
  const autoLevel = pickLevel(classified, breakingCount);
  const level = forceLevel ?? autoLevel;

  const pkg = JSON.parse(fs.readFileSync(PKG_PATH, "utf-8"));
  const currentVersion = pkg.version;
  const newVersion = bumpVersion(currentVersion, level);
  const tag = `v${newVersion}`;

  // 前置：tag 已存在校验。本地 tag 与远端 tag 都查，避免 push 时才发现冲突
  const localTags = new Set(
    tryGit(["tag", "--list"])
      .split("\n")
      .map((t) => t.trim())
      .filter(Boolean)
  );
  if (localTags.has(tag)) {
    console.error(
      `✗ 本地已存在 tag ${tag}。若需重新发布：git tag -d ${tag} && git push origin :refs/tags/${tag}`
    );
    process.exit(1);
  }
  const remoteTags = new Set(
    tryGit(["ls-remote", "--tags", "origin", `refs/tags/${tag}`])
      .split("\n")
      .map((line) => line.replace(/.*refs\/tags\//, "").trim())
      .filter(Boolean)
  );
  if (remoteTags.has(tag)) {
    console.error(
      `✗ 远端已存在 tag ${tag}。若需重新发布：git push origin :refs/tags/${tag}`
    );
    process.exit(1);
  }

  const notes = buildNotes(newVersion, from, classified);

  // 解析 owner/repo（用于打印 Release 链接）
  const repoInfo = tryGit(["config", "--get", "remote.origin.url"]);
  const match = repoInfo.match(/(?:[:/])([^/]+)\/([^/]+?)(?:\.git)?$/);
  const ownerRepo = match ? `${match[1]}/${match[2]}` : "CCweixiao/InkPress";

  // ---------- 预览输出 ----------
  console.log("═".repeat(64));
  console.log(`  InkPress 版本发布${dryRun ? "（DRY-RUN 预览）" : ""}`);
  console.log("═".repeat(64));
  console.log(`  仓库      : ${ownerRepo}`);
  console.log(`  上次 tag  : ${from || "（无）"}`);
  console.log(`  提交数    : ${commits.length}（含 ${breakingCount} 条破坏性变更）`);
  console.log(`  当前版本  : v${currentVersion}`);
  console.log(`  建议等级  : ${autoLevel}${forceLevel ? `（已强制为 ${forceLevel}）` : ""}`);
  console.log(`  目标版本  : ${tag}`);
  console.log(`  推送      : ${doPush ? "是（commit + tag）" : "否"}`);
  console.log("─".repeat(64));
  console.log(notes);
  console.log("─".repeat(64));

  if (dryRun) {
    console.log("\n✓ Dry-run 完成，未做任何改动。去掉 --dry-run 执行实际发布。");
    return;
  }

  // ---------- 确认 ----------
  if (!noConfirm) {
    const rl = readline.createInterface({ input, output });
    const answer = (
      await rl.question(`\n确认发布 ${tag}？(y/N) `)
    ).trim().toLowerCase();
    rl.close();
    if (answer !== "y" && answer !== "yes") {
      console.log("✗ 已取消。");
      process.exit(0);
    }
  }

  // ---------- 执行：更新 version ----------
  pkg.version = newVersion;
  fs.writeFileSync(PKG_PATH, JSON.stringify(pkg, null, 2) + "\n", "utf-8");
  console.log(`✓ package.json → ${newVersion}`);

  // ---------- 执行：commit ----------
  git(["add", "package.json"]);
  git(["commit", "-m", `chore(release): ${tag}`, "-m", notes]);

  // ---------- 执行：tag（annotated，message 为 Release Notes）----------
  git(["tag", "-a", tag, "-m", notes]);
  console.log(`✓ 已打 tag ${tag}`);

  // ---------- 可选：push ----------
  if (doPush) {
    git(["push", "origin", "HEAD"]);
    git(["push", "origin", tag]);
    console.log(`✓ 已推送 commit 与 tag 至 origin`);
  }

  console.log("\n" + "═".repeat(64));
  console.log(`  🎉 ${tag} 发布完成`);
  console.log("═".repeat(64));
  console.log(`  Release 页面 : https://github.com/${ownerRepo}/releases/new?tag=${tag}`);
  console.log(`  Actions 流水线 : 推送 tag 后自动触发（${doPush ? "已推送" : "需手动 git push origin ${tag}"}）`);
  console.log(`  安装包将在 https://github.com/${ownerRepo}/releases/tag/${tag} 生成`);
  if (!doPush) {
    console.log(`\n  ⚠️  尚未推送。执行：git push origin HEAD && git push origin ${tag}`);
  }
}

main().catch((err) => {
  console.error("\n✗ 发布失败：", err.message);
  process.exit(1);
});
