#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawn, spawnSync } from "node:child_process";

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i], process.argv[i + 1]);
const platform = args.get("--platform");
const arch = args.get("--arch");
const dist = path.resolve(args.get("--dist") || path.join(process.cwd(), "dist"));
const explicitExecutable = args.get("--executable");
const timeoutMs = Number(args.get("--timeout-ms") || 120_000);

if (!new Set(["darwin", "win32"]).has(platform)) abort("--platform 必须是 darwin|win32");
if (!new Set(["arm64", "x64"]).has(arch)) abort("--arch 必须是 arm64|x64");

const executable = locateExecutable();
const smokeHome = fs.mkdtempSync(path.join(os.tmpdir(), `inkpress-package-smoke-${platform}-${arch}-`));
const output = [];
let outputBytes = 0;
const maxOutputBytes = 2 * 1024 * 1024;

probePackagedRuntime();

console.log(`→ 启动打包态 smoke test：${executable}`);
const child = spawn(executable, [], {
  cwd: path.dirname(executable),
  env: {
    ...process.env,
    INKPRESS_PACKAGE_SMOKE_TEST: "1",
    INKPRESS_SMOKE_HOME: smokeHome,
    ELECTRON_ENABLE_LOGGING: "1",
  },
  stdio: ["ignore", "pipe", "pipe"],
  windowsHide: true,
});

for (const stream of [child.stdout, child.stderr]) {
  stream.on("data", (chunk) => {
    process.stdout.write(chunk);
    if (outputBytes < maxOutputBytes) {
      output.push(chunk.toString());
      outputBytes += chunk.length;
    }
  });
}

const timer = setTimeout(() => {
  console.error(`✗ smoke test 超过 ${timeoutMs}ms，终止进程 ${child.pid}`);
  if (process.platform === "win32" && child.pid) {
    spawnSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], { stdio: "inherit" });
  } else {
    child.kill("SIGKILL");
  }
}, timeoutMs);

const exitCode = await new Promise((resolve) => {
  child.once("exit", (code, signal) => resolve(code ?? (signal ? 128 : 1)));
  child.once("error", (error) => {
    console.error(error);
    resolve(1);
  });
});
clearTimeout(timer);

const combined = output.join("");
try {
  fs.rmSync(smokeHome, { recursive: true, force: true });
} catch {
  // Windows 杀进程后可能短暂持有日志句柄；不影响 smoke 判定。
}

if (exitCode !== 0) abort(`打包态应用退出码 ${exitCode}${tailOutput()}`);
if (!combined.includes("[electron-smoke] PASS")) {
  abort(`未看到 [electron-smoke] PASS 标记，退出码 ${exitCode}${tailOutput()}`);
}
console.log(`✓ 打包态 smoke test 通过：${platform}-${arch}`);

function locateExecutable() {
  if (explicitExecutable) {
    const file = path.resolve(explicitExecutable);
    if (!fs.existsSync(file)) abort(`指定的主程序不存在：${file}`);
    if (!matchesNativeArch(file)) abort(`指定的主程序架构不是 ${platform}-${arch}：${file}`);
    return file;
  }
  if (!fs.existsSync(dist)) abort(`dist 不存在：${dist}`);
  if (platform === "darwin") {
    const app = findDirectories(dist, "InkPress.app").find((candidate) => {
      const file = path.join(candidate, "Contents", "MacOS", "InkPress");
      return fs.existsSync(file) && matchesNativeArch(file);
    });
    if (!app) abort("找不到 InkPress.app 解包目录");
    const file = path.join(app, "Contents", "MacOS", "InkPress");
    if (!fs.existsSync(file)) abort(`找不到主程序：${file}`);
    return file;
  }
  const unpacked = findDirectories(dist, "win-unpacked").find((candidate) => {
    const file = path.join(candidate, "InkPress.exe");
    return fs.existsSync(file) && matchesNativeArch(file);
  });
  if (!unpacked) abort("找不到 win-unpacked 解包目录");
  const file = path.join(unpacked, "InkPress.exe");
  if (!fs.existsSync(file)) abort(`找不到主程序：${file}`);
  return file;
}

function findDirectories(base, wanted) {
  const results = [];
  const visit = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const full = path.join(dir, entry.name);
      if (entry.name === wanted) {
        results.push(full);
        continue;
      }
      visit(full);
    }
  };
  visit(base);
  return results;
}

function matchesNativeArch(file) {
  if (platform === "darwin") {
    const result = spawnSync("file", ["-b", file], { encoding: "utf8" });
    const expected = arch === "x64" ? "x86_64" : "arm64";
    return result.status === 0 && result.stdout.toLowerCase().includes(expected);
  }
  try {
    return readPeMachine(file) === 0x8664;
  } catch {
    return false;
  }
}

function readPeMachine(file) {
  const fd = fs.openSync(file, "r");
  try {
    const dos = Buffer.alloc(64);
    if (fs.readSync(fd, dos, 0, dos.length, 0) !== dos.length) return null;
    if (dos.readUInt16LE(0) !== 0x5a4d) return null;
    const offset = dos.readUInt32LE(0x3c);
    const pe = Buffer.alloc(6);
    if (fs.readSync(fd, pe, 0, pe.length, offset) !== pe.length) return null;
    if (pe.toString("ascii", 0, 4) !== "PE\0\0") return null;
    return pe.readUInt16LE(4);
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * 直接用安装包内 Electron 的 Node 模式加载原生模块，避免“文件存在且架构正确，
 * 但 ABI/依赖损坏”直到用户使用数据库或 SVG 渲染时才暴露。
 */
function probePackagedRuntime() {
  const paths = packagedPaths();
  const probe = `
const path = require("node:path");
const base = ${JSON.stringify(paths.standalone)};
process.chdir(base);
const react = require("react");
if (!react || typeof react.createElement !== "function") throw new Error("React react-server export failed");
const Database = require(path.join(base, "node_modules", "better-sqlite3"));
const db = new Database(":memory:");
const row = db.prepare("select 1 as ok").get();
db.close();
if (!row || row.ok !== 1) throw new Error("better-sqlite3 query failed");
const { Resvg } = require(path.join(base, "node_modules", "@resvg", "resvg-js"));
const png = new Resvg('<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><rect width="2" height="2" fill="#000"/></svg>').render().asPng();
if (!Buffer.isBuffer(png) || png.length < 40) throw new Error("Resvg render failed");
console.log("[native-runtime-probe] PASS");
`;
  const env = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: "1",
    HOME: smokeHome,
    USERPROFILE: smokeHome,
  };
  const result = spawnSync(paths.nodeRunner, ["--conditions=react-server", "-e", probe], {
    cwd: paths.standalone,
    env,
    encoding: "utf8",
    timeout: 60_000,
    windowsHide: true,
  });
  const probeOutput = `${result.stdout || ""}${result.stderr || ""}`;
  if (result.status !== 0 || !probeOutput.includes("[native-runtime-probe] PASS")) {
    abort(
      `安装包原生运行时探针失败（status=${result.status}, signal=${result.signal || "none"}）\n${probeOutput.slice(-6000)}`
    );
  }

  const cli = spawnSync(paths.claude, ["--version"], {
    cwd: paths.standalone,
    env,
    encoding: "utf8",
    timeout: 30_000,
    windowsHide: true,
  });
  const cliOutput = `${cli.stdout || ""}${cli.stderr || ""}`.trim();
  if (cli.status !== 0 || !cliOutput) {
    abort(
      `Claude CLI 探针失败（status=${cli.status}, signal=${cli.signal || "none"}）\n${cliOutput.slice(-3000)}`
    );
  }
  console.log(`✓ 安装包运行时通过：React 条件导出、better-sqlite3、Resvg、Claude CLI (${cliOutput.split("\n")[0]})`);
}

function packagedPaths() {
  if (platform === "darwin") {
    const contents = path.resolve(path.dirname(executable), "..");
    const resources = path.join(contents, "Resources");
    return {
      standalone: path.join(resources, "standalone"),
      nodeRunner: path.join(
        contents,
        "Frameworks",
        "InkPress Helper.app",
        "Contents",
        "MacOS",
        "InkPress Helper"
      ),
      claude: path.join(
        resources,
        "standalone",
        "node_modules",
        "@anthropic-ai",
        `claude-agent-sdk-darwin-${arch}`,
        "claude"
      ),
    };
  }
  const resources = path.join(path.dirname(executable), "resources");
  return {
    standalone: path.join(resources, "standalone"),
    nodeRunner: executable,
    claude: path.join(
      resources,
      "standalone",
      "node_modules",
      "@anthropic-ai",
      "claude-agent-sdk-win32-x64",
      "claude.exe"
    ),
  };
}

function abort(message) {
  console.error(`✗ ${message}`);
  process.exit(1);
}

function tailOutput() {
  const text = output.join("").trim();
  if (!text) return "";
  return `\n--- smoke output tail ---\n${text.slice(-6000)}`;
}
