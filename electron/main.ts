import { app, BrowserWindow, shell } from "electron";
import { spawn, ChildProcess } from "node:child_process";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import net from "node:net";
import { SPLASH_LOGO_DATA_URL } from "./splash-logo";

/**
 * InkPress Electron 主进程（自包含，不依赖 src/lib，便于 electron-builder 打包）。
 *
 * 职责：
 * 1. 首次启动初始化 ~/.inkpress（建目录 + 建表 + seed 主题）
 * 2. spawn Next.js standalone server（ELECTRON_RUN_AS_NODE=1，用 Node ABI 加载原生模块）
 * 3. BrowserWindow 加载 localhost，退出时 kill server
 *
 * 用户数据统一归属 ~/.inkpress；只读资源（系统 skill、主题 CSS）从 app 资源区读取。
 */

const PREFERRED_PORT = 17391;

let serverProc: ChildProcess | null = null;
let mainWindow: BrowserWindow | null = null;
let serverPort = PREFERRED_PORT;
let isQuitting = false;
let splash: BrowserWindow | null = null;

/**
 * 是否处于打包形态。
 * app.isPackaged 为真，或显式设置 INKPRESS_PACKAGED_TEST=1（用于本地测试打包流程）。
 */
function isPackaged(): boolean {
  return app.isPackaged || process.env.INKPRESS_PACKAGED_TEST === "1";
}

/** 用户数据根目录：打包=~/.inkpress，开发=null（用项目目录） */
function dataHome(): string | null {
  return isPackaged() ? path.join(os.homedir(), ".inkpress") : null;
}
/** SQLite db 路径：打包=~/.inkpress/database/inkpress.db，开发=项目根/dev.db */
function dbFile(): string {
  const home = dataHome();
  return home
    ? path.join(home, "database", "inkpress.db")
    : path.join(process.cwd(), "dev.db");
}
/**
 * 只读资源根：打包=app Resources 目录，开发测试=standalone-bundle 目录。
 * 注意：server 子进程不应依赖此函数，应通过 INKPRESS_RESOURCES_DIR env 获取。
 */
function resourcesDir(): string {
  if (app.isPackaged) return process.resourcesPath!;
  // INKPRESS_PACKAGED_TEST 模式：用去符号链接的 bundle 作为资源根
  if (isPackaged()) return path.join(process.cwd(), ".next", "standalone-bundle");
  return process.cwd();
}
/** standalone server.js 路径（打包=Resources/standalone，开发=bundle 或 standalone） */
function serverFile(): string {
  if (app.isPackaged) return path.join(process.resourcesPath, "standalone", "server.js");
  if (isPackaged()) return path.join(process.cwd(), ".next", "standalone-bundle", "server.js");
  return path.join(process.cwd(), ".next", "standalone", "server.js");
}

/* ============ 首次启动初始化 ============ */

/** 确保 ~/.inkpress 目录结构存在（仅打包形态） */
function ensureDirs() {
  const home = dataHome();
  if (!home) return;
  for (const dir of [
    home,
    path.join(home, "storage", "articles"),
    path.join(home, "cache"),
    path.join(home, "database"),
    path.join(home, "database", "backups"),
    path.join(home, "database", "scripts"),
    path.join(home, "resources", "skills", "user"),
    path.join(home, "logs"),
  ]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * 首次启动初始化：仅建目录结构。
 *
 * 数据库建表 + 主题 seed 在 Next server 进程启动时由 instrumentation.ts 执行
 * （server 进程在标准 Node 运行时下加载 better-sqlite3 原生模块，无 ABI 冲突）。
 * 主进程不直接加载 better-sqlite3，规避 Electron Node ABI 与标准 Node ABI 的不匹配。
 */
function bootstrapData() {
  ensureDirs();
}

/* ============ Server 生命周期 ============ */

async function pickPort(preferred: number): Promise<number> {
  const tryPort = (port: number) =>
    new Promise<boolean>((resolve) => {
      const tester = net
        .createServer()
        .once("error", () => resolve(false))
        .once("listening", () => tester.once("close", () => resolve(true)).close())
        .listen(port, "127.0.0.1");
    });
  if (await tryPort(preferred)) return preferred;
  for (let p = preferred + 1; p < preferred + 50; p++) {
    if (await tryPort(p)) return p;
  }
  return preferred;
}

function startServer(port: number): ChildProcess {
  const serverDir = path.dirname(serverFile());
  /**
   * 打包形态：用 electron-builder 生成并签名好的 LSUIElement Helper 启动 server，
   * 避免 macOS Dock 显示第二个图标。开发形态：直接用 process.execPath。
   */
  const serverExe = app.isPackaged
    ? path.join(process.resourcesPath!, "..", "Frameworks", "InkPress Helper.app", "Contents", "MacOS", "InkPress Helper")
    : process.execPath;
  // bundle 内的 node_modules 保留原名（prepare-standalone 已物化 pnpm symlink
  // 为真实文件，且 extraResources 不受 files 规则的 node_modules 剔除影响）。
  // Node 标准 require 解析天然从 server.js 同级的 node_modules 查找，无需 NODE_PATH。
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PORT: String(port),
    HOSTNAME: "127.0.0.1",
    NODE_ENV: "production",
    // 以纯 Node 模式运行 Electron 内置 Node（server 进程用此 ABI 加载 better-sqlite3）
    ELECTRON_RUN_AS_NODE: "1",
  };
  const home = dataHome();
  if (home) {
    // 打包形态：显式注入用户数据目录与只读资源根（避免子进程 process.resourcesPath 误判）
    env.DATABASE_URL = `file:${dbFile()}`;
    env.INKPRESS_HOME = home;
    // 资源根：RESOURCE_ROOT（主）与 INKPRESS_RESOURCES_DIR（兼容别名）等值注入
    env.RESOURCE_ROOT = resourcesDir();
    env.INKPRESS_RESOURCES_DIR = resourcesDir();
  }
  const proc = spawn(serverExe, [serverFile()], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
    cwd: serverDir,
  });
  proc.stdout?.on("data", (d) => process.stdout.write(`[next] ${d}`));
  proc.stderr?.on("data", (d) => process.stderr.write(`[next] ${d}`));
  proc.on("exit", (code) => console.log(`[next] server exited code=${code}`));
  return proc;
}

/**
 * 优雅关闭 server 子进程：SIGTERM → 等 exit → 兜底 SIGKILL。
 * 返回的 Promise 在 server 真正退出后 resolve，杜绝孤儿进程。
 */
function killServer(): Promise<void> {
  return new Promise((resolve) => {
    if (!serverProc || serverProc.killed) {
      resolve();
      return;
    }
    const pid = serverProc.pid;
    let settled = false;
    const done = () => {
      if (!settled) {
        settled = true;
        resolve();
      }
    };
    serverProc.once("exit", done);
    try {
      serverProc.kill("SIGTERM");
    } catch {
      done();
      return;
    }
    // 5 秒后兜底 SIGKILL（直接用 pid，确保即便 ChildProcess 句柄失效也能杀掉）
    setTimeout(() => {
      if (!settled && pid) {
        try {
          process.kill(pid, "SIGKILL");
        } catch {
          /* 进程已退出，忽略 */
        }
        setTimeout(done, 500);
      }
    }, 5000);
  });
}

function waitForServer(port: number, timeoutMs = 30000): Promise<void> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tryConnect = () => {
      const socket = new net.Socket();
      socket.setTimeout(1000);
      socket
        .once("connect", () => {
          socket.destroy();
          resolve();
        })
        .once("error", () => retry(socket))
        .once("timeout", () => retry(socket))
        .connect(port, "127.0.0.1");
    };
    const retry = (socket: net.Socket) => {
      socket.destroy();
      if (Date.now() - start > timeoutMs) reject(new Error("等待 Next 服务启动超时"));
      else setTimeout(tryConnect, 300);
    };
    tryConnect();
  });
}

/* ============ 启动 splash ============ */

/**
 * 启动过渡页 HTML：logo + 「正在启动 InkPress…」+ CSS 旋转 loading。
 * logo 以 base64 data URL 内嵌（splash 在 Next server 起来前显示，无法从 public/ 取；
 * 打包后 build/icon.png 也不进 app bundle）。dev / packaged 两种形态都稳。
 */
function splashHTML(): string {
  return `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'" />
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 100%; height: 100%; overflow: hidden; }
  body {
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    gap: 22px;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
    background: #ffffff; color: #334155;
    -webkit-user-select: none; user-select: none;
  }
  .logo { width: 128px; height: 128px; }
  .title { font-size: 15px; font-weight: 600; letter-spacing: 0.02em; }
  .spinner {
    width: 28px; height: 28px;
    border: 3px solid #e2e8f0; border-top-color: #6366f1;
    border-radius: 50%;
    animation: ip-spin 0.8s linear infinite;
  }
  @keyframes ip-spin { to { transform: rotate(360deg); } }
</style>
</head>
<body>
  <img class="logo" src="${SPLASH_LOGO_DATA_URL}" alt="InkPress" />
  <div class="title">正在启动 InkPress…</div>
  <div class="spinner"></div>
</body>
</html>`;
}

function showSplash() {
  splash = new BrowserWindow({
    width: 480,
    height: 360,
    frame: false,
    center: true,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    show: true,
    backgroundColor: "#ffffff",
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  splash.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(splashHTML()));
  splash.on("closed", () => {
    splash = null;
  });
}

function closeSplash() {
  if (splash && !splash.isDestroyed()) splash.close();
  splash = null;
}

async function createWindow(port: number) {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 680,
    title: "InkPress",
    backgroundColor: "#ffffff",
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  await mainWindow.loadURL(`http://127.0.0.1:${port}`);
  mainWindow.show();
  // 外链在系统浏览器打开
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });
}

async function bootstrap() {
  showSplash();
  try {
    bootstrapData();
    serverPort = await pickPort(PREFERRED_PORT);
    serverProc = startServer(serverPort);
    await waitForServer(serverPort);
    await createWindow(serverPort);
    closeSplash();
  } catch (e) {
    console.error("[electron] 启动失败：", e);
    // 失败时清理 server 子进程，避免孤儿进程占用端口
    // （waitForServer 超时、createWindow 抛异常等情况下 serverProc 可能已 spawn）
    await killServer();
    closeSplash();
    mainWindow = new BrowserWindow({ width: 600, height: 400 });
    const msg = e instanceof Error ? e.message : String(e);
    mainWindow.loadURL(
      "data:text/html;charset=utf-8," +
        encodeURIComponent(
          `<body style="font-family:system-ui;padding:40px;color:#b91c1c"><img src="${SPLASH_LOGO_DATA_URL}" style="width:56px;height:56px;display:block;margin:0 auto 16px" alt="InkPress" /><h2>InkPress 启动失败</h2><pre>${msg}</pre></body>`
        )
    );
  }
}

app.whenReady().then(() => {
  void bootstrap();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0 && serverProc && !serverProc.killed) {
      void createWindow(serverPort);
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

/**
 * 退出流程：阻止默认退出，先优雅 kill server 并等待其真正退出，再退出主进程。
 * isQuitting 标志防止重入（Cmd+Q 多次点击 / app.quit() 递归）。
 */
app.on("before-quit", (e) => {
  if (isQuitting) return;
  isQuitting = true;
  e.preventDefault();
  void killServer().then(() => {
    app.quit();
  });
});

// 捕获终端信号（Ctrl-C / kill），走统一退出流程清理 server
process.on("SIGINT", () => app.quit());
process.on("SIGTERM", () => app.quit());

process.on("uncaughtException", (e) => {
  console.error("[electron] uncaughtException:", e);
  // 异常时也尝试清理 server，避免孤儿进程
  void killServer().finally(() => process.exit(1));
});
