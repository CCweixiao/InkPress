#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  args.set(process.argv[i], process.argv[i + 1]);
}

const phase = args.get("--phase");
const platform = args.get("--platform");
const arch = args.get("--arch");
const root = process.cwd();
const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const packageVersion = packageJson.version;
const dist = path.resolve(args.get("--dist") || path.join(root, "dist"));
const bundle = path.resolve(args.get("--bundle") || path.join(root, ".next", "standalone-bundle"));
const requireMacSignature = ["1", "true"].includes(
  String(process.env.INKPRESS_REQUIRE_MAC_SIGNATURE || "").toLowerCase()
);
const requireWindowsSignature = ["1", "true"].includes(
  String(process.env.INKPRESS_REQUIRE_WINDOWS_SIGNATURE || "").toLowerCase()
);

if (!new Set(["host", "bundle", "artifact"]).has(phase)) fail("--phase 必须是 host|bundle|artifact");
if (!new Set(["darwin", "win32"]).has(platform)) fail("--platform 必须是 darwin|win32");
if (!new Set(["arm64", "x64"]).has(arch)) fail("--arch 必须是 arm64|x64");
if (platform === "win32" && arch !== "x64") fail("当前 Windows 发布仅支持 x64");

if (phase === "host") verifyHost();
else if (phase === "bundle") verifyBundle(bundle);
else verifyArtifact();

function fail(message) {
  console.error(`✗ 打包校验失败：${message}`);
  process.exit(1);
}

function verifyHost() {
  if (process.platform !== platform) fail(`runner 平台应为 ${platform}，实际 ${process.platform}`);
  if (process.arch !== arch) fail(`runner 架构应为 ${arch}，实际 ${process.arch}`);
  const nodeMajor = Number(process.versions.node.split(".")[0]);
  if (nodeMajor !== 22) fail(`Node 必须为 22.x，实际 ${process.versions.node}`);
  console.log(`✓ 构建宿主校验通过：${process.platform}-${process.arch}, Node ${process.versions.node}`);
}

function platformSpecs(base) {
  if (platform === "darwin") {
    return [
      path.join(base, "node_modules", "@anthropic-ai", `claude-agent-sdk-darwin-${arch}`, "claude"),
      path.join(base, "node_modules", "@resvg", `resvg-js-darwin-${arch}`, `resvgjs.darwin-${arch}.node`),
    ];
  }
  return [
    path.join(base, "node_modules", "@anthropic-ai", "claude-agent-sdk-win32-x64", "claude.exe"),
    path.join(base, "node_modules", "@resvg", "resvg-js-win32-x64-msvc", "resvgjs.win32-x64-msvc.node"),
  ];
}

function verifyBundle(base) {
  const required = [
    "server.js",
    "server.jsc",
    "server.jsc.sha256",
    ".next/BUILD_ID",
    ".next/required-server-files.json",
    ".next/static",
    "public",
    "resources/skills/system",
    "themes",
    "migrations",
    "node_modules/next/package.json",
    "node_modules/better-sqlite3/package.json",
    "node_modules/bytenode/lib/index.js",
    "node_modules/jsdom/package.json",
    "node_modules/@exodus/bytes/fallback/single-byte.encodings.js",
    "node_modules/ts-morph/package.json",
    "node_modules/picomatch/lib/picomatch.js",
  ];
  for (const rel of required) requirePath(path.join(base, rel), rel);
  const tracedRoot = path.join(base, ".next", "node_modules");
  if (fs.existsSync(tracedRoot)) {
    for (const entry of fs.readdirSync(tracedRoot, { withFileTypes: true })) {
      const tracedPackage = ["jsdom", "ts-morph"].find((name) =>
        entry.name.startsWith(`${name}-`)
      );
      if (entry.isDirectory() && tracedPackage) {
        const nested = path.join(tracedRoot, entry.name, "node_modules");
        if (fs.existsSync(nested)) {
          fail(`traced ${tracedPackage} 仍含深层 node_modules：${path.relative(base, nested)}`);
        }
      }
    }
  }
  const buildId = fs.readFileSync(path.join(base, ".next", "BUILD_ID"), "utf8").trim();
  if (!buildId) fail("bundle 的 .next/BUILD_ID 为空");

  const expectedBytecodeHash = fs
    .readFileSync(path.join(base, "server.jsc.sha256"), "utf8")
    .trim();
  const actualBytecodeHash = crypto
    .createHash("sha256")
    .update(fs.readFileSync(path.join(base, "server.jsc")))
    .digest("hex");
  if (expectedBytecodeHash !== actualBytecodeHash) fail("bundle 的 server.jsc SHA-256 不匹配");

  const requiredServerFiles = fs.readFileSync(
    path.join(base, ".next", "required-server-files.json"),
    "utf8"
  );
  let requiredServerValue;
  try {
    requiredServerValue = JSON.parse(requiredServerFiles);
  } catch (error) {
    fail(`required-server-files.json 无法解析：${String(error)}`);
  }
  if (valueContainsBuildRoot(requiredServerValue)) {
    fail("required-server-files.json 泄漏构建机绝对路径");
  }
  for (const binary of platformSpecs(base)) {
    requirePath(binary, path.relative(base, binary));
    verifyNativeArch(binary);
  }
  verifyPlatformPackageSet(base);
  verifyPlatformPackageVersions(base);
  verifyResourceMirror(base);

  const badRoots = [".env", "dist", "storage", "dev.database", "graphify-out", "inkpress-service"];
  for (const rel of badRoots) {
    if (fs.existsSync(path.join(base, rel))) fail(`bundle 泄漏开发/敏感目录：${rel}`);
  }
  if (fs.existsSync(path.join(base, "node_modules", "sharp"))) fail("bundle 仍包含构建期 sharp");

  const symlinks = [];
  const traceManifests = [];
  walk(base, (file, entry) => {
    if (entry.isSymbolicLink()) symlinks.push(path.relative(base, file));
    if (entry.isFile() && file.endsWith(".nft.json")) traceManifests.push(path.relative(base, file));
  });
  if (symlinks.length) fail(`bundle 含 ${symlinks.length} 个符号链接：${symlinks.slice(0, 5).join(", ")}`);
  if (traceManifests.length) {
    fail(`bundle 仍含 ${traceManifests.length} 个构建期 *.nft.json：${traceManifests.slice(0, 3).join(", ")}`);
  }

  const nativeBindings = [];
  walk(base, (file, entry) => {
    if (entry.isFile() && file.endsWith(".node")) nativeBindings.push(file);
  });
  if (!nativeBindings.some((file) => path.basename(file) === "better_sqlite3.node")) {
    fail("bundle 缺少 better_sqlite3.node");
  }
  for (const file of nativeBindings) verifyNativeArch(file);
  console.log(`✓ bundle 校验通过：${formatSize(sizeOf(base))}，${nativeBindings.length} 个原生绑定，arch=${arch}`);
}

function verifyArtifact() {
  requirePath(dist, "dist");
  let appDir;
  let executable;
  let resources;
  if (platform === "darwin") {
    appDir = findDirectories(dist, (name) => name === "InkPress.app").find((candidate) => {
      const binary = path.join(candidate, "Contents", "MacOS", "InkPress");
      return fs.existsSync(binary) && nativeArchMatches(binary) && macAppVersion(candidate) === packageVersion;
    });
    if (!appDir) fail("dist 下找不到版本和架构均匹配的 InkPress.app 解包目录");
    executable = path.join(appDir, "Contents", "MacOS", "InkPress");
    resources = path.join(appDir, "Contents", "Resources");
    verifyMacLocales(appDir);
    verifyMacMinimumSystemVersion(appDir);
    const dmg = path.join(dist, `InkPress-${packageVersion}-${arch}.dmg`);
    requireLargeFile(dmg, `${arch} DMG`);
    const verify = spawnSync("hdiutil", ["verify", dmg], { encoding: "utf8" });
    if (verify.status !== 0) fail(`DMG 校验失败：${verify.stderr || verify.stdout}`);
    verifyDmgFormatAndContents(dmg);
    const macBinaries = findMacBinaries(appDir);
    if (macBinaries.length < 4) fail(`macOS App 内 Mach-O 数量异常：${macBinaries.length}`);
    for (const binary of macBinaries) verifyNativeArch(binary);
    if (requireMacSignature) verifyMacSignature(appDir);
  } else {
    const unpacked = findDirectory(dist, "win-unpacked");
    if (!unpacked) fail("dist 下找不到 win-unpacked 解包目录");
    appDir = unpacked;
    executable = path.join(appDir, "InkPress.exe");
    resources = path.join(appDir, "resources");
    verifyWindowsLocales(appDir);
    const installer = path.join(dist, `InkPress-${packageVersion}-x64.exe`);
    requireLargeFile(installer, "Windows x64 NSIS 安装器");
    const windowsBinaries = findWindowsBinaries(appDir);
    if (windowsBinaries.length < 4) fail(`Windows 解包目录 PE 数量异常：${windowsBinaries.length}`);
    for (const binary of windowsBinaries) verifyNativeArch(binary);
    if (requireWindowsSignature) {
      verifyWindowsSignature(installer);
      verifyWindowsSignature(executable);
    }
  }

  requirePath(executable, "主程序");
  verifyNativeArch(executable);
  verifyBundle(path.join(resources, "standalone"));
  for (const rel of ["themes", path.join("resources", "skills", "system"), "migrations"]) {
    requirePath(path.join(resources, rel), `Resources/${rel}`);
  }
  verifyTreeMatch(path.join(root, "themes"), path.join(resources, "themes"), "外层 themes");
  verifyTreeMatch(
    path.join(root, "resources", "skills", "system"),
    path.join(resources, "resources", "skills", "system"),
    "外层 system skills"
  );
  verifyTreeMatch(
    path.join(root, "prisma", "migrations"),
    path.join(resources, "migrations"),
    "外层 migrations"
  );
  console.log(`✓ 安装包产物校验通过：${platform}-${arch}，app=${formatSize(sizeOf(appDir))}`);
}

function verifyMacLocales(appDir) {
  const localeDir = path.join(
    appDir,
    "Contents",
    "Frameworks",
    "Electron Framework.framework",
    "Versions",
    "A",
    "Resources"
  );
  requirePath(localeDir, "Electron Framework locales");
  const actual = fs.readdirSync(localeDir).filter((name) => name.endsWith(".lproj")).sort();
  const expected = ["en.lproj", "zh_CN.lproj"];
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail(`macOS locale 应仅为 ${expected.join(", ")}，实际 ${actual.join(", ")}`);
  }
}

function verifyWindowsLocales(appDir) {
  const localeDir = path.join(appDir, "locales");
  requirePath(localeDir, "Windows locales");
  const actual = fs.readdirSync(localeDir).filter((name) => name.endsWith(".pak")).sort();
  const expected = ["en-US.pak", "zh-CN.pak"];
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail(`Windows locale 应仅为 ${expected.join(", ")}，实际 ${actual.join(", ")}`);
  }
}

function verifyDmgFormatAndContents(dmg) {
  const info = spawnSync("hdiutil", ["imageinfo", dmg], { encoding: "utf8" });
  if (info.status !== 0 || !/^\s*Format:\s*ULFO\s*$/m.test(info.stdout)) {
    fail(`DMG 应使用 ULFO/LZFSE，实际：${info.stdout || info.stderr}`);
  }

  const temp = fs.mkdtempSync(path.join(os.tmpdir(), `inkpress-dmg-verify-${arch}-`));
  const mountPoint = path.join(temp, "volume");
  fs.mkdirSync(mountPoint);
  let mounted = false;
  try {
    const attach = spawnSync(
      "hdiutil",
      ["attach", "-readonly", "-nobrowse", "-noautoopen", "-mountpoint", mountPoint, dmg],
      { encoding: "utf8", timeout: 120_000 }
    );
    if (attach.status !== 0) fail(`DMG 无法挂载：${attach.stderr || attach.stdout}`);
    mounted = true;
    const mountedApp = path.join(mountPoint, "InkPress.app");
    requirePath(mountedApp, "DMG/InkPress.app");
    const mountedExecutable = path.join(mountedApp, "Contents", "MacOS", "InkPress");
    requirePath(mountedExecutable, "DMG 主程序");
    verifyNativeArch(mountedExecutable);
    if (macAppVersion(mountedApp) !== packageVersion) {
      fail(`DMG 内 App 版本不匹配：${macAppVersion(mountedApp)} != ${packageVersion}`);
    }
    const applications = path.join(mountPoint, "Applications");
    if (!fs.existsSync(applications) || !fs.lstatSync(applications).isSymbolicLink()) {
      fail("DMG 缺少 Applications 安装链接");
    }
  } finally {
    if (mounted) spawnSync("hdiutil", ["detach", mountPoint, "-force"], { stdio: "ignore" });
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

function verifyMacSignature(appDir) {
  for (const [command, commandArgs, label] of [
    ["codesign", ["--verify", "--deep", "--strict", "--verbose=2", appDir], "codesign"],
    ["xcrun", ["stapler", "validate", appDir], "notarization ticket"],
  ]) {
    const result = spawnSync(command, commandArgs, { encoding: "utf8", timeout: 120_000 });
    if (result.status !== 0) fail(`${label} 校验失败：${result.stderr || result.stdout}`);
  }
  verifyMacGatekeeper(appDir);
  console.log("✓ macOS Developer ID 签名、公证与 stapler ticket 校验通过");
}

function verifyMacGatekeeper(appDir) {
  const maxAttempts = 3;
  const retryDelaysMs = [5_000, 15_000];
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const result = spawnSync(
      "spctl",
      ["--assess", "--type", "execute", "--verbose=2", appDir],
      { encoding: "utf8", timeout: 120_000 }
    );
    if (result.status === 0) {
      if (attempt > 1) console.log(`✓ Gatekeeper 校验在第 ${attempt} 次尝试后通过`);
      return;
    }

    const output = [result.stderr, result.stdout].filter(Boolean).join("\n").trim();
    const transientSubsystemError = /internal error in code signing subsystem/i.test(output);
    if (!transientSubsystemError || attempt === maxAttempts) {
      fail(`Gatekeeper 校验失败（尝试 ${attempt}/${maxAttempts}）：${output || `exit=${result.status}`}`);
    }

    const delayMs = retryDelaysMs[attempt - 1];
    console.warn(`⚠ Gatekeeper Code Signing 子系统瞬时异常（尝试 ${attempt}/${maxAttempts}）：${output}`);
    console.warn(`  ${delayMs / 1_000} 秒后重试；codesign 与公证票据校验已通过`);
    sleepSync(delayMs);
  }
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function verifyMacMinimumSystemVersion(appDir) {
  const configured = String(packageJson.build?.mac?.minimumSystemVersion || "");
  const declared = plistValue(path.join(appDir, "Contents", "Info.plist"), "LSMinimumSystemVersion");
  if (!configured || !declared || compareVersions(configured, declared) !== 0) {
    fail(`macOS 最低系统版本不一致：config=${configured || "缺失"}, Info.plist=${declared || "缺失"}`);
  }
  for (const binary of findMacBinaries(appDir)) {
    for (const minimum of machMinimumVersions(binary)) {
      if (compareVersions(minimum, declared) > 0) {
        fail(
          `${path.relative(appDir, binary)} 要求 macOS ${minimum}，高于 App 声明的 ${declared}`
        );
      }
    }
  }
}

function macAppVersion(appDir) {
  return plistValue(path.join(appDir, "Contents", "Info.plist"), "CFBundleShortVersionString");
}

function plistValue(plist, key) {
  const result = spawnSync("plutil", ["-extract", key, "raw", "-o", "-", plist], {
    encoding: "utf8",
  });
  return result.status === 0 ? result.stdout.trim() : null;
}

function machMinimumVersions(binary) {
  // classic otool 会把文件名末尾的 `(GPU)` / `(Renderer)` 误解析为 archive
  // member 语法，即使通过无 shell 的 argv 调用也会截断路径。vtool 对 Electron
  // Helper 路径没有该问题，并且会直接输出 LC_BUILD_VERSION / minos。
  const result = spawnSync("xcrun", ["vtool", "-show-build", binary], {
    encoding: "utf8",
  });
  if (result.status !== 0) fail(`vtool 无法读取 ${binary}：${result.stderr}`);
  const versions = new Set();
  for (const command of result.stdout.split(/(?=Load command \d+)/)) {
    if (command.includes("cmd LC_BUILD_VERSION")) {
      const match = /^\s*minos\s+([0-9.]+)\s*$/m.exec(command);
      if (match) versions.add(match[1]);
    } else if (command.includes("cmd LC_VERSION_MIN_MACOSX")) {
      const match = /^\s*version\s+([0-9.]+)\s*$/m.exec(command);
      if (match) versions.add(match[1]);
    }
  }
  return [...versions];
}

function compareVersions(left, right) {
  const a = String(left).split(".").map(Number);
  const b = String(right).split(".").map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (a[i] || 0) - (b[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function valueContainsBuildRoot(value) {
  const nativeRoot = root;
  const posixRoot = root.split(path.sep).join("/");
  if (typeof value === "string") {
    return [nativeRoot, posixRoot].some((variant) => value.includes(variant));
  }
  if (Array.isArray(value)) return value.some(valueContainsBuildRoot);
  if (value && typeof value === "object") {
    return Object.values(value).some(valueContainsBuildRoot);
  }
  return false;
}

function verifyNativeArch(file) {
  if (platform === "darwin") {
    const result = spawnSync("file", ["-b", file], { encoding: "utf8" });
    const expected = arch === "x64" ? "x86_64" : "arm64";
    if (result.status !== 0 || !result.stdout.toLowerCase().includes(expected)) {
      fail(`${path.relative(root, file)} 架构应为 ${expected}：${result.stdout || result.stderr}`);
    }
    return;
  }
  const actual = readPeMachine(file);
  if (actual !== 0x8664) fail(`${file} 不是 Windows x64 PE（machine=0x${actual.toString(16)}）`);
}

function nativeArchMatches(file) {
  try {
    if (platform === "darwin") {
      const result = spawnSync("file", ["-b", file], { encoding: "utf8" });
      const expected = arch === "x64" ? "x86_64" : "arm64";
      return result.status === 0 && result.stdout.toLowerCase().includes(expected);
    }
    return readPeMachine(file) === 0x8664;
  } catch {
    return false;
  }
}

function readPeMachine(file) {
  const fd = fs.openSync(file, "r");
  try {
    const dos = Buffer.alloc(64);
    if (fs.readSync(fd, dos, 0, dos.length, 0) !== dos.length || dos.readUInt16LE(0) !== 0x5a4d) {
      fail(`${file} 不是有效 PE 文件`);
    }
    const offset = dos.readUInt32LE(0x3c);
    const pe = Buffer.alloc(6);
    if (fs.readSync(fd, pe, 0, pe.length, offset) !== pe.length || pe.toString("ascii", 0, 4) !== "PE\0\0") {
      fail(`${file} 缺少 PE header`);
    }
    return pe.readUInt16LE(4);
  } finally {
    fs.closeSync(fd);
  }
}

function findMacBinaries(appDir) {
  const binaries = [];
  walk(appDir, (file, entry) => {
    if (!entry.isFile()) return;
    const stat = fs.statSync(file);
    if ((stat.mode & 0o111) === 0 && !/\.(?:node|dylib)$/i.test(file)) return;
    const result = spawnSync("file", ["-b", file], { encoding: "utf8" });
    if (result.status === 0 && result.stdout.includes("Mach-O")) binaries.push(file);
  });
  return binaries;
}

function findWindowsBinaries(appDir) {
  const binaries = [];
  walk(appDir, (file, entry) => {
    if (entry.isFile() && /\.(?:exe|dll|node)$/i.test(file)) binaries.push(file);
  });
  return binaries;
}

function verifyWindowsSignature(file) {
  const script =
    "$s=Get-AuthenticodeSignature -LiteralPath $env:INKPRESS_SIGNATURE_FILE; " +
    "if ($s.Status -ne 'Valid') { Write-Error ($s.Status.ToString() + ': ' + $s.StatusMessage); exit 1 }";
  const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
    encoding: "utf8",
    env: { ...process.env, INKPRESS_SIGNATURE_FILE: file },
  });
  if (result.status !== 0) fail(`Authenticode 校验失败 ${file}：${result.stderr || result.stdout}`);
}

function verifyPlatformPackageSet(base) {
  const anthropicRoot = path.join(base, "node_modules", "@anthropic-ai");
  const resvgRoot = path.join(base, "node_modules", "@resvg");
  const expectedAnthropic =
    platform === "darwin" ? `claude-agent-sdk-darwin-${arch}` : "claude-agent-sdk-win32-x64";
  const expectedResvg =
    platform === "darwin" ? `resvg-js-darwin-${arch}` : "resvg-js-win32-x64-msvc";
  const nativeAnthropic = fs
    .readdirSync(anthropicRoot)
    .filter((name) => /^claude-agent-sdk-(?:darwin|win32)-/.test(name))
    .sort();
  const nativeResvg = fs
    .readdirSync(resvgRoot)
    .filter((name) => /^resvg-js-(?:darwin|win32)-/.test(name))
    .sort();
  if (JSON.stringify(nativeAnthropic) !== JSON.stringify([expectedAnthropic])) {
    fail(`Claude 平台包应仅为 ${expectedAnthropic}，实际 ${nativeAnthropic.join(", ")}`);
  }
  if (JSON.stringify(nativeResvg) !== JSON.stringify([expectedResvg])) {
    fail(`Resvg 平台包应仅为 ${expectedResvg}，实际 ${nativeResvg.join(", ")}`);
  }
}

function verifyPlatformPackageVersions(base) {
  const packageVersionAt = (...parts) => {
    const file = path.join(base, "node_modules", ...parts, "package.json");
    requirePath(file, path.relative(base, file));
    return JSON.parse(fs.readFileSync(file, "utf8")).version;
  };
  const anthropicParent = packageVersionAt("@anthropic-ai", "claude-agent-sdk");
  const anthropicChild = packageVersionAt(
    "@anthropic-ai",
    platform === "darwin" ? `claude-agent-sdk-darwin-${arch}` : "claude-agent-sdk-win32-x64"
  );
  if (anthropicParent !== anthropicChild) {
    fail(`Claude SDK 平台包版本漂移：wrapper=${anthropicParent}, native=${anthropicChild}`);
  }
  const resvgParent = packageVersionAt("@resvg", "resvg-js");
  const resvgChild = packageVersionAt(
    "@resvg",
    platform === "darwin" ? `resvg-js-darwin-${arch}` : "resvg-js-win32-x64-msvc"
  );
  if (resvgParent !== resvgChild) {
    fail(`Resvg 平台包版本漂移：wrapper=${resvgParent}, native=${resvgChild}`);
  }

  if (platform === "darwin") {
    const claude = platformSpecs(base)[0];
    if ((fs.statSync(claude).mode & 0o111) === 0) fail("Claude CLI 丢失可执行权限");
  }
}

function verifyResourceMirror(base) {
  for (const [source, destination, label] of [
    [path.join(root, ".next", "static"), path.join(base, ".next", "static"), ".next/static"],
    [path.join(root, "public"), path.join(base, "public"), "public"],
    [path.join(root, "themes"), path.join(base, "themes"), "themes"],
    [
      path.join(root, "resources", "skills", "system"),
      path.join(base, "resources", "skills", "system"),
      "system skills",
    ],
    [path.join(root, "prisma", "migrations"), path.join(base, "migrations"), "migrations"],
  ]) {
    verifyTreeMatch(source, destination, label);
  }
  const skills = [];
  walk(path.join(base, "resources", "skills", "system"), (file, entry) => {
    if (entry.isFile() && entry.name === "SKILL.md") skills.push(file);
  });
  if (skills.length === 0) fail("bundle 系统 Skill 内容为空（缺少 SKILL.md）");
}

function verifyTreeMatch(source, destination, label) {
  requirePath(source, `${label} 源目录`);
  requirePath(destination, `${label} 目标目录`);
  const expected = treeManifest(source);
  const actual = treeManifest(destination);
  if (expected.size !== actual.size) {
    fail(`${label} 文件数不一致：源=${expected.size}，目标=${actual.size}`);
  }
  for (const [file, hash] of expected) {
    if (actual.get(file) !== hash) fail(`${label} 缺失或内容不一致：${file}`);
  }
}

function treeManifest(base) {
  const result = new Map();
  walk(base, (file, entry) => {
    if (!entry.isFile()) return;
    const rel = path.relative(base, file).split(path.sep).join("/");
    result.set(rel, crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"));
  });
  return result;
}

function requireLargeFile(file, label) {
  let stat;
  try {
    stat = fs.statSync(file);
  } catch {
    fail(`找不到 ${label}：${file}`);
  }
  if (!stat.isFile() || stat.size < 1024 * 1024) fail(`${label} 无效或过小：${file}`);
}

function findDirectory(base, name) {
  return findDirectories(base, (entryName) => entryName === name)[0] || null;
}

function findDirectories(base, predicate) {
  const found = [];
  if (!fs.existsSync(base)) return found;
  const visit = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const full = path.join(dir, entry.name);
      if (predicate(entry.name)) found.push(full);
      else visit(full);
    }
  };
  visit(base);
  return found;
}

function walk(base, callback) {
  if (!fs.existsSync(base)) return;
  const visit = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      callback(full, entry);
      if (entry.isDirectory()) visit(full);
    }
  };
  visit(base);
}

function requirePath(file, label) {
  if (!fs.existsSync(file)) fail(`缺少 ${label}: ${file}`);
}

function sizeOf(target) {
  if (!fs.existsSync(target)) return 0;
  const stat = fs.statSync(target);
  if (stat.isFile()) return stat.size;
  let total = 0;
  walk(target, (file, entry) => {
    if (entry.isFile()) total += fs.statSync(file).size;
  });
  return total;
}

function formatSize(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
