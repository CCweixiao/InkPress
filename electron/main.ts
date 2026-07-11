import { app, BrowserWindow, shell } from "electron";
import { spawn, ChildProcess } from "node:child_process";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import net from "node:net";
import http from "node:http";
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
const isPackageSmokeTest = process.env.INKPRESS_PACKAGE_SMOKE_TEST === "1";

if (isPackageSmokeTest && process.env.INKPRESS_SMOKE_HOME?.trim()) {
  app.setPath(
    "userData",
    path.join(path.resolve(process.env.INKPRESS_SMOKE_HOME.trim()), "electron-user-data")
  );
}

/**
 * 是否处于打包形态。
 * app.isPackaged 为真，或显式设置 INKPRESS_PACKAGED_TEST=1（用于本地测试打包流程）。
 */
function isPackaged(): boolean {
  return app.isPackaged || process.env.INKPRESS_PACKAGED_TEST === "1";
}

/** 用户数据根目录：打包=平台默认数据目录，开发=null（用项目目录） */
function dataHome(): string | null {
  if (isPackageSmokeTest && process.env.INKPRESS_SMOKE_HOME?.trim()) {
    return path.resolve(process.env.INKPRESS_SMOKE_HOME.trim());
  }
  return isPackaged() ? defaultDataHome() : null;
}

/**
 * 默认用户数据根（按平台约定）。mac= ~/.inkpress（不破坏存量）；Windows=%APPDATA%\InkPress；
 * Linux=$XDG_DATA_HOME/inkpress。与 src/lib/paths.ts 同构（main.ts 自包含、不依赖 src/lib）。
 */
function defaultDataHome(): string {
  if (process.platform === "win32") {
    const appdata = process.env.APPDATA?.trim();
    return path.join(
      appdata || path.join(os.homedir(), "AppData", "Roaming"),
      "InkPress"
    );
  }
  if (process.platform === "linux") {
    const xdg = process.env.XDG_DATA_HOME?.trim();
    return path.join(xdg || path.join(os.homedir(), ".local", "share"), "inkpress");
  }
  return path.join(os.homedir(), ".inkpress");
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

/**
 * B9：恢复出厂兑现。若用户经 /api/settings/data/reset 写入 .reset 标记，
 * 主进程启动时（server 尚未打开 DB）清空数据目录全部内容（含标记自身），随后正常初始化。
 * 仅打包形态执行；开发模式无主进程，需手动清理。
 */
function performResetIfMarked() {
  const home = dataHome();
  if (!home) return;
  const marker = path.join(home, ".reset");
  if (!fs.existsSync(marker)) return;
  try {
    for (const entry of fs.readdirSync(home)) {
      fs.rmSync(path.join(home, entry), { recursive: true, force: true });
    }
    console.log("[electron] 已执行恢复出厂：清空用户数据目录");
  } catch (e) {
    console.error("[electron] 恢复出厂失败：", e);
  }
}

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
  performResetIfMarked();
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
   * 打包形态选择 server runner 可执行文件：
   * - macOS：用 electron-builder 生成并签名好的 LSUIElement Helper（InkPress Helper.app）
   *   启动 server，避免 Dock 显示第二个图标。Helper 是 mac 专属机制。
   * - Windows / Linux：直接用主进程 exe（process.execPath）在 ELECTRON_RUN_AS_NODE=1
   *   下当 Node 用。Windows 没有 Helper 结构，主进程 exe 即 server runner。
   * 开发形态：所有平台都用 process.execPath。
   */
  const serverExe = app.isPackaged
    ? process.platform === "darwin"
      ? path.join(process.resourcesPath!, "..", "Frameworks", "InkPress Helper.app", "Contents", "MacOS", "InkPress Helper")
      : process.execPath
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
    // 构建期版本透传：server 读 APP_VERSION 而非 process.cwd()/package.json（后者在打包态依赖 cwd，脆弱）。
    APP_VERSION: app.getVersion(),
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

function smokeRequest(port: number, pathname: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.get(
      // Windows runner 上首次请求会同步完成数据库迁移、内置主题初始化和
      // Next 首次路由加载；端口已经监听并不代表首页能在 10 秒内返回。
      // 给单次健康检查完整的冷启动窗口，外层 smoke runner 仍有 120 秒
      // 总超时，因此真正的死锁/启动失败仍会让发布失败。
      { hostname: "127.0.0.1", port, path: pathname, timeout: 60_000 },
      (res) => {
        const chunks: Buffer[] = [];
        let bytes = 0;
        res.on("data", (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes <= 1024 * 1024) chunks.push(chunk);
        });
        res.on("end", () => {
          if (bytes > 1024 * 1024) {
            reject(new Error(`${pathname} 响应超过 1 MB`));
            return;
          }
          resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") });
        });
      }
    );
    req.once("timeout", () => req.destroy(new Error(`${pathname} 请求超时`)));
    req.once("error", reject);
  });
}

/** CI 直接启动已打包 app，验证 Next、数据库、迁移、主题资源和 API 均可运行。 */
async function runPackageSmokeChecks(port: number): Promise<void> {
  const home = await smokeRequest(port, "/");
  if (home.status < 200 || home.status >= 400 || !home.body.includes("<!DOCTYPE html")) {
    throw new Error(`首页 smoke 失败：HTTP ${home.status}`);
  }

  const themes = await smokeRequest(port, "/api/themes");
  const themesJson = JSON.parse(themes.body) as { themes?: unknown[] };
  if (themes.status !== 200 || !Array.isArray(themesJson.themes) || themesJson.themes.length === 0) {
    throw new Error(`主题 API smoke 失败：HTTP ${themes.status}`);
  }

  const settings = await smokeRequest(port, "/api/settings/status");
  if (settings.status !== 200) throw new Error(`设置 API smoke 失败：HTTP ${settings.status}`);
  JSON.parse(settings.body);

  const skills = await smokeRequest(port, "/api/skills");
  const skillsJson = JSON.parse(skills.body) as {
    skills?: Array<{ source?: string; editable?: boolean }>;
  };
  const hasSystemSkill =
    skills.status === 200 &&
    Array.isArray(skillsJson.skills) &&
    skillsJson.skills.some((skill) => skill.source === "system" && skill.editable === false);
  if (!hasSystemSkill) throw new Error(`系统 Skill API smoke 失败：HTTP ${skills.status}`);

  console.log("[electron-smoke] HTTP /, /api/themes, /api/settings/status, /api/skills 均通过");
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
  if (!isPackageSmokeTest) showSplash();
  try {
    bootstrapData();
    serverPort = await pickPort(PREFERRED_PORT);
    serverProc = startServer(serverPort);
    // B2 快速失败：server 若在启动期（waitForServer 完成前）退出，立即拒绝，
    // 不必等 30s 超时。常见于版本守卫 exit(1)（DB schema 比当前 app 新）。
    const earlyExit = new Promise<never>((_, reject) => {
      const onExit = (code: number | null) => {
        reject(
          new Error(
            `server 子进程启动期间退出（code=${code}）。可能原因：数据库版本不兼容（请升级 InkPress）、原生模块 ABI 不匹配、端口占用。详见 ~/.inkpress/logs/inkpress.log`
          )
        );
      };
      serverProc?.once("exit", onExit);
    });
    try {
      await Promise.race([waitForServer(serverPort), earlyExit]);
    } finally {
      // 启动成功后剥离 earlyExit 监听，避免正常运行期的 exit 触发未捕获 rejection。
      serverProc?.removeAllListeners("exit");
      serverProc?.on("exit", (code) =>
        console.log(`[next] server exited code=${code}`)
      );
    }
    if (isPackageSmokeTest) {
      await runPackageSmokeChecks(serverPort);
      await killServer();
      console.log("[electron-smoke] PASS");
      isQuitting = true;
      app.quit();
      return;
    }
    await createWindow(serverPort);
    closeSplash();
  } catch (e) {
    console.error("[electron] 启动失败：", e);
    // 失败时清理 server 子进程，避免孤儿进程占用端口
    // （waitForServer 超时、createWindow 抛异常等情况下 serverProc 可能已 spawn）
    await killServer();
    closeSplash();
    if (isPackageSmokeTest) {
      console.error("[electron-smoke] FAIL");
      isQuitting = true;
      app.exit(1);
      return;
    }
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

// B1 单实例锁：避免双开两进程写同一 SQLite（last-write-wins / SQLITE_BUSY / 数据损坏风险）。
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  // 已有实例运行 → 直接退出。
  app.quit();
} else {
  app.on("second-instance", () => {
    // 二次启动：聚焦已有主窗口（而非再起一个 server）。
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      if (!mainWindow.isVisible()) mainWindow.show();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    void bootstrap();
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0 && serverProc && !serverProc.killed) {
        void createWindow(serverPort);
      }
    });
  });
}

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
