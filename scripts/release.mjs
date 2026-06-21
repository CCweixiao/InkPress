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

/** 判定某条提交是否包含 breaking change（subject 带 ! 或 body 含 BREAKING CHANGE） */
function isBreaking(c) {
  return (
    (c.subject.includes("!") && CC_RE.test(c.subject)) ||
    /BREAKING[ -]CHANGE/i.test(c.body)
  );
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
  // 前置：必须在 git 仓库、工作区干净（仅提示）
  const dirty = hasUncommittedChanges();
  if (dirty.length > 0) {
    console.warn(
      `⚠️  工作区有 ${dirty.length} 处未提交改动，建议先提交或 stash。本脚本只新增 release commit。`
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

  const notes = buildNotes(newVersion, from, classified);
  const tag = `v${newVersion}`;

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
