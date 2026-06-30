import os from "node:os";
import path from "node:path";

/**
 * 运行时路径统一解析。
 *
 * 两种运行形态：
 * - 开发模式（pnpm dev）：无 INKPRESS_HOME → 回落到项目目录，保持现有行为。
 * - 桌面应用（Electron 打包）/ 服务端部署（Docker）：用户数据统一归属 dataHome，只读资源从资源根读取。
 *
 * 资源根目录（resourceRoot）优先级（高 → 低）：
 *   RESOURCE_ROOT > INKPRESS_RESOURCES_DIR（向后兼容别名）> process.cwd()
 *
 * 用户数据根（dataHome）优先级：
 *   INKPRESS_HOME > 默认 ~/.inkpress（仅当存在打包信号时）
 *
 * 用户数据（DB、文章正文、缓存、用户 skill、日志）写入 dataHome；
 * 只读资源（系统 skill 原件、内置主题 CSS、迁移脚本）从 resourceRoot 读。
 */

/**
 * 是否使用独立用户数据目录（~/.inkpress）。
 *
 * 判定依据：显式设置 INKPRESS_HOME（最可靠，Electron 主进程与 Docker 均通过此变量告知 server 子进程）。
 */
const isPackaged = !!process.env.INKPRESS_HOME && process.env.INKPRESS_HOME.trim().length > 0;

/**
 * InkPress 用户数据主目录。
 *
 * 与 dataHome() 不同：这个函数在开发模式也返回 ~/.inkpress，供必须与项目工作区
 * 和第三方默认目录完全隔离的运行时使用（例如 Claude Agent SDK）。
 */
export function inkpressHomeDir(): string {
  if (process.env.INKPRESS_HOME && process.env.INKPRESS_HOME.trim()) {
    return path.resolve(process.env.INKPRESS_HOME.trim());
  }
  return path.join(os.homedir(), ".inkpress");
}

/**
 * 用户数据根目录。
 * - 开发模式：返回 null，调用方据此回落到项目目录（保持 pnpm dev 行为不变）。
 * - 打包/INKPRESS_HOME 设置：返回绝对路径（INKPRESS_HOME 或默认 ~/.inkpress）。
 */
export function dataHome(): string | null {
  if (process.env.INKPRESS_HOME && process.env.INKPRESS_HOME.trim()) {
    return path.resolve(process.env.INKPRESS_HOME.trim());
  }
  if (isPackaged) {
    return path.join(os.homedir(), ".inkpress");
  }
  return null;
}

/** 是否使用独立用户数据目录（即不在项目目录运行） */
export function usesDataHome(): boolean {
  return dataHome() !== null;
}

/**
 * 只读资源根目录（统一入口）。
 *
 * 优先级：
 *   1. RESOURCE_ROOT（主变量名）
 *   2. INKPRESS_RESOURCES_DIR（向后兼容别名，Electron 主进程已注入）
 *   3. process.cwd()（开发 / Docker 兜底）
 *
 * 不依赖 process.resourcesPath（在 server 子进程下会误指向 Electron.app）。
 */
export function resourceRoot(): string {
  const root = process.env.RESOURCE_ROOT || process.env.INKPRESS_RESOURCES_DIR;
  if (root && root.trim()) {
    return path.resolve(root.trim());
  }
  return process.cwd();
}

/**
 * 只读资源根目录（别名，保持向后兼容）。
 * @deprecated 新代码请直接使用 {@link resourceRoot}。
 */
export function resourcesDir(): string {
  return resourceRoot();
}

/** SQLite 数据库文件绝对路径 */
export function dbPath(): string {
  const home = dataHome();
  return home
    ? path.join(databaseDir(), "inkpress.db")
    : path.join(process.cwd(), "dev.db");
}

/** DATABASE_URL（Prisma 适配器消费） */
export function databaseUrl(): string {
  return `file:${dbPath()}`;
}

/**
 * 数据库目录：~/.inkpress/database（打包）或 null（开发用项目根）。
 * 统一存放 inkpress.db、备份文件、迁移脚本留档。
 */
export function databaseDir(): string {
  const home = dataHome();
  if (home) return path.join(home, "database");
  return path.join(process.cwd(), "dev.database");
}

/** 数据库备份目录（迁移前自动备份，滚动保留 5 份） */
export function backupDir(): string {
  return path.join(databaseDir(), "backups");
}

/** 迁移脚本留档目录（执行成功后拷贝脚本副本 + 写 .success 标识） */
export function migrationScriptsDir(): string {
  return path.join(databaseDir(), "scripts");
}

/** 文章正文等文件存储根目录 */
export function storageDir(): string {
  // CONTENT_DIR 仍可覆盖（用于测试 / 自定义部署）
  if (process.env.CONTENT_DIR && process.env.CONTENT_DIR.trim()) {
    return path.resolve(process.env.CONTENT_DIR.trim());
  }
  const home = dataHome();
  return home ? path.join(home, "storage") : path.join(process.cwd(), "storage");
}

/** 临时文件 / 缓存目录（分片上传临时文件等） */
export function cacheDir(): string {
  const home = dataHome();
  return home ? path.join(home, "cache") : path.join(process.cwd(), "storage", "tmp");
}

/** Claude Agent SDK 专用目录：不读写用户 ~/.claude，也不落到项目工作区。 */
export function claudeAgentRuntimeDir(): string {
  return path.join(inkpressHomeDir(), "cache", "claude-agent");
}

/** 日志目录：~/.inkpress/logs（打包）或 项目根/logs（开发） */
export function logsDir(): string {
  const home = dataHome();
  return home ? path.join(home, "logs") : path.join(process.cwd(), "logs");
}

/** 安装/更新标记文件：~/.inkpress/.update */
export function markerFile(): string {
  const home = dataHome();
  return home ? path.join(home, ".update") : path.join(process.cwd(), ".update");
}

/**
 * 用户 skill 可写目录（用户创建/AI 生成/上传的 skill）。
 * 永不被 app 更新触碰。
 */
export function userSkillsDir(): string {
  const home = dataHome();
  return home
    ? path.join(home, "resources", "skills", "user")
    : path.join(process.cwd(), "resources", "skills", "user");
}

/**
 * 系统 skill 只读目录（内置 skill 原件，随 app 分发）。
 * 运行时从资源根实时读取；app 更新（替换整个包）即自动全量更新，天然只读。
 */
export function systemSkillsDir(): string {
  return path.join(resourceRoot(), "resources", "skills", "system");
}

/** 内置主题 CSS 只读目录 */
export function themesDir(): string {
  return path.join(resourceRoot(), "themes");
}

/**
 * Prisma migrations 目录（版本化迁移脚本源）。
 * - 打包：资源根/migrations（由 prepare-standalone 复制 prisma/migrations → standalone/migrations）
 * - 开发：prisma/migrations（项目原始位置，dev 仍用 prisma migrate dev）
 *
 * 每个版本目录可含 migration.sql（DDL，Prisma 生成）与可选 data.sql（DML 预设，幂等）。
 */
export function migrationsDir(): string {
  if (isPackaged) return path.join(resourceRoot(), "migrations");
  return path.join(process.cwd(), "prisma", "migrations");
}
