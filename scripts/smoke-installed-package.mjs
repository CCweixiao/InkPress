#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i], process.argv[i + 1]);

const platform = args.get("--platform");
const arch = args.get("--arch");
const root = process.cwd();
const dist = path.resolve(args.get("--dist") || path.join(root, "dist"));
const packageVersion = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version;

if (!new Set(["darwin", "win32"]).has(platform)) fail("--platform 必须是 darwin|win32");
if (!new Set(["arm64", "x64"]).has(arch)) fail("--arch 必须是 arm64|x64");
if (platform === "win32" && arch !== "x64") fail("Windows 安装包当前仅支持 x64");
if (process.platform !== platform) fail(`安装烟测必须在目标平台原生执行：期望 ${platform}，实际 ${process.platform}`);

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), `inkpress-install-smoke-${platform}-${arch}-`));
const mountPoint = path.join(tempRoot, "dmg");
let mounted = false;

try {
  if (platform === "darwin") smokeDmgInstall();
  else smokeNsisInstall();
  console.log(`✓ 安装介质 smoke test 通过：${platform}-${arch}`);
} finally {
  if (mounted) {
    spawnSync("hdiutil", ["detach", mountPoint, "-force"], { stdio: "ignore" });
  }
  try {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  } catch (error) {
    console.warn(`⚠ 临时安装目录稍后由系统清理：${tempRoot} (${String(error)})`);
  }
}

function smokeDmgInstall() {
  const dmg = path.join(dist, `InkPress-${packageVersion}-${arch}.dmg`);
  requireLargeFile(dmg, "DMG");
  fs.mkdirSync(mountPoint, { recursive: true });
  run("hdiutil", ["attach", "-readonly", "-nobrowse", "-noautoopen", "-mountpoint", mountPoint, dmg], {
    timeout: 120_000,
  });
  mounted = true;

  const mountedApp = path.join(mountPoint, "InkPress.app");
  if (!fs.statSync(mountedApp).isDirectory()) fail("DMG 根目录缺少 InkPress.app");
  const applicationsLink = path.join(mountPoint, "Applications");
  if (!fs.lstatSync(applicationsLink).isSymbolicLink()) fail("DMG 缺少 Applications 安装链接");

  // ditto 保留 macOS bundle 元数据和签名，等价模拟 Finder 拖入 Applications。
  const installedApp = path.join(tempRoot, "Applications", "InkPress.app");
  fs.mkdirSync(path.dirname(installedApp), { recursive: true });
  run("ditto", [mountedApp, installedApp], { timeout: 300_000 });

  run("hdiutil", ["detach", mountPoint], { timeout: 60_000 });
  mounted = false;
  smokeExecutable(path.join(installedApp, "Contents", "MacOS", "InkPress"));
}

function smokeNsisInstall() {
  const installer = path.join(dist, `InkPress-${packageVersion}-x64.exe`);
  requireLargeFile(installer, "NSIS 安装器");
  const installDir = path.join(tempRoot, "InkPress Test Install 中文路径");

  // /D 必须是最后一个参数；中文与空格路径同时覆盖常见 Windows 安装边界。
  run(installer, ["/S", "/currentuser", `/D=${installDir}`], { timeout: 300_000 });
  const executable = path.join(installDir, "InkPress.exe");
  if (!fs.existsSync(executable)) fail(`NSIS 安装完成但主程序不存在：${executable}`);
  smokeExecutable(executable);

  const uninstaller = findFile(installDir, (name) => /^Uninstall.*\.exe$/i.test(name));
  if (!uninstaller) fail("NSIS 安装目录缺少卸载程序");
  if (["1", "true"].includes(String(process.env.INKPRESS_REQUIRE_WINDOWS_SIGNATURE || "").toLowerCase())) {
    verifyWindowsSignature(uninstaller);
  }
  run(uninstaller, ["/S", "/currentuser"], { timeout: 180_000 });
  // NSIS 会把 uninstaller 自复制到临时目录：主 exe 往往先消失，资源随后才删。
  // 等整个安装目录不再含文件，避免过早检查产生 race，也避免“只删主程序”假通过。
  waitForCondition(
    () => !fs.existsSync(executable) && findFile(installDir, () => true) === null,
    30_000
  );
  if (fs.existsSync(executable)) fail("NSIS 卸载完成后主程序仍然存在");
  const residue = findFile(installDir, () => true);
  if (residue) fail(`NSIS 卸载后仍残留文件：${residue}`);
}

function smokeExecutable(executable) {
  if (!fs.existsSync(executable)) fail(`安装后的主程序不存在：${executable}`);
  run(
    process.execPath,
    [
      path.join(root, "scripts", "smoke-packaged-app.mjs"),
      "--platform",
      platform,
      "--arch",
      arch,
      "--executable",
      executable,
    ],
    { timeout: 180_000 }
  );
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

function findFile(base, predicate) {
  if (!fs.existsSync(base)) return null;
  let entries;
  try {
    entries = fs.readdirSync(base, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const entry of entries) {
    const full = path.join(base, entry.name);
    if (entry.isFile() && predicate(entry.name)) return full;
    if (entry.isDirectory()) {
      const nested = findFile(full, predicate);
      if (nested) return nested;
    }
  }
  return null;
}

function waitForCondition(predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  const signal = new Int32Array(new SharedArrayBuffer(4));
  while (!predicate() && Date.now() < deadline) {
    Atomics.wait(signal, 0, 0, 250);
  }
}

function verifyWindowsSignature(file) {
  const script =
    "$s=Get-AuthenticodeSignature -LiteralPath $env:INKPRESS_SIGNATURE_FILE; " +
    "if ($s.Status -ne 'Valid') { Write-Error ($s.Status.ToString() + ': ' + $s.StatusMessage); exit 1 }";
  const result = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", script],
    {
      encoding: "utf8",
      windowsHide: true,
      env: { ...process.env, INKPRESS_SIGNATURE_FILE: file },
    }
  );
  if (result.status !== 0) {
    fail(`卸载程序 Authenticode 校验失败：${result.stderr || result.stdout}`);
  }
}

function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, {
    stdio: "inherit",
    windowsHide: true,
    ...options,
  });
  if (result.error) fail(`${command} 启动失败：${result.error.message}`);
  if (result.status !== 0) {
    fail(`${command} 退出码 ${result.status}${result.signal ? `，signal=${result.signal}` : ""}`);
  }
}

function fail(message) {
  throw new Error(`安装介质 smoke test 失败：${message}`);
}
