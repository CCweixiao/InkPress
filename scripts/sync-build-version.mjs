#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const raw = process.argv[2]?.trim();
if (!raw) {
  console.error("✗ 缺少 tag/version 参数");
  process.exit(1);
}

const version = raw.startsWith("v") ? raw.slice(1) : raw;
const semver = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
if (!semver.test(version)) {
  console.error(`✗ tag 版本号非法: ${raw}（期望 vX.Y.Z 或合法 SemVer）`);
  process.exit(1);
}

const packagePath = path.join(process.cwd(), "package.json");
const pkg = JSON.parse(fs.readFileSync(packagePath, "utf8"));
pkg.version = version;
fs.writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);
console.log(`✓ package.json version → ${version}（来源: ${raw}）`);
