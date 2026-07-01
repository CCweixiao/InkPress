import fs from "node:fs";
import path from "node:path";
import {
  dataHome,
  dbPath,
  databaseDir,
  backupDir,
  migrationScriptsDir,
  storageDir,
  cacheDir,
  userSkillsDir,
  logsDir,
  claudeAgentRuntimeDir,
  markerFile,
  migrationsDir,
  usesDataHome,
} from "@/lib/paths";
import { runMigrations } from "@/lib/migration";
import { seedBuiltInThemes } from "@/lib/themes/loader";
import { moduleLogger } from "@/lib/logger";

const log = moduleLogger("init");

/** 读取 app 版本（package.json） */
function appVersion(): string {
  try {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8")
    );
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

/**
 * 桌面应用 / 服务端部署首次启动初始化（幂等）。
 *
 * 由 Next.js instrumentation.ts（server 进程启动时）调用，确保在标准 Node 运行时下执行，
 * 从而原生加载 better-sqlite3（避免 Electron 主进程的 Node ABI 冲突）。
 *
 * 打包形态（usesDataHome() 为真）执行完整初始化；开发模式只做幂等 seed
 * （内置主题 + 默认空间），目录创建与 schema 迁移仍归 prisma migrate dev。
 *
 * 打包形态步骤：
 * 1. 创建 ~/.inkpress 下的子目录结构（含 database/backups/scripts、user skills、logs）
 * 2. 检测首次安装 vs 更新（.update 标记），写版本元数据
 * 3. 版本化迁移：备份 → 事务执行 DDL/DML → 写 migration_history + .success 审计标识
 *    （支持跨版本更新；旧库自动兼容导入 _prisma_migrations）
 * 4. seed 内置主题 + 默认空间
 *
 * 系统 skill 不再拷贝：运行时从资源根只读目录实时读取，app 更新即自动全量更新。
 */
export async function ensureDataHome(): Promise<void> {
  // 开发模式：用项目目录下的 dev.db。目录创建与 schema 迁移归 prisma migrate dev 管，
  // 这里不介入；但仍需 seed 内置主题与默认空间（均幂等），否则重建 dev.db
  // （切分支带新 migration / migrate reset / 删除 dev.db）后主题列表会空。
  if (!usesDataHome()) {
    await seedBuiltInThemes().catch((e) => {
      log.error({ err: e }, "seed 内置主题失败（开发模式）");
    });
    await ensureDefaultSpace().catch((e) => {
      log.error({ err: e }, "seed 默认空间失败（开发模式）");
    });
    return;
  }

  const home = dataHome()!;
  const version = appVersion();

  // 检测首次安装 vs 更新：目录不存在 → 首次安装
  const isFirstInstall = !fs.existsSync(home);

  // 1. 建目录结构（主进程已建部分，这里幂等确保全部存在）
  for (const dir of [
    home,
    storageDir(),
    path.join(storageDir(), "articles"),
    path.join(storageDir(), "spaces"),
    path.join(storageDir(), "library"),
    path.join(storageDir(), "code-sources"),
    path.join(storageDir(), "technical-documents"),
    cacheDir(),
    databaseDir(),
    backupDir(),
    migrationScriptsDir(),
    userSkillsDir(),
    claudeAgentRuntimeDir(),
    path.join(claudeAgentRuntimeDir(), "config"),
    path.join(claudeAgentRuntimeDir(), "workspace"),
    logsDir(),
  ]) {
    fs.mkdirSync(dir, { recursive: true });
  }

  if (isFirstInstall) {
    log.info({ home }, "首次安装，初始化用户数据目录");
  } else {
    log.info({ home, version }, "检测到已有数据目录，执行更新");
  }

  // 写/更新 .update 标记（记录版本与时间，不覆盖任何用户数据）
  writeMarker(version, isFirstInstall);

  // 2. 版本化迁移（幂等，每次启动补齐未执行版本）
  await runMigrations(dbPath(), migrationsDir());

  // 3. seed 内置主题（幂等，已存在则更新）
  await seedBuiltInThemes().catch((e) => {
    log.error({ err: e }, "seed 内置主题失败");
  });

  // 4. seed 默认空间（幂等：若无默认空间，取首个空间标记或新建一个）
  await ensureDefaultSpace().catch((e) => {
    log.error({ err: e }, "seed 默认空间失败");
  });
}

/**
 * 保证存在一个系统默认空间（名字固定为「默认空间」，系统初始化时自动创建）。
 * 用户创建的空间永远不会被标记为默认——默认空间是独立的、不可编辑/删除的系统空间。
 * 升级兼容：若 DB 中无 isDefault 空间，则新建一个名为「默认空间」的系统空间（不挪用用户空间）。
 */
async function ensureDefaultSpace() {
  const { prisma } = await import("@/lib/db");
  // 已存在默认空间则无需处理
  const hasDefault = await prisma.space.findFirst({
    where: { isDefault: true, trashed: false },
  });
  if (hasDefault) return;
  // 修复历史误标：若存在已被错误标记为 isDefault 的回收空间，清除标记
  await prisma.space.updateMany({
    where: { isDefault: true, trashed: true },
    data: { isDefault: false },
  });
  // 新建系统默认空间（固定名称，sortOrder 最小，置顶）
  await prisma.space.create({
    data: {
      name: "默认空间",
      description: "系统默认空间，不可编辑或删除",
      sortOrder: 0,
      pinned: true,
      isDefault: true,
    },
  });
}

/** 写/更新 .update 标记文件（version + 时间戳） */
function writeMarker(version: string, isFirstInstall: boolean) {
  const marker = markerFile();
  try {
    let prev: { version?: string; installedAt?: string; updatedAt?: string } = {};
    if (!isFirstInstall && fs.existsSync(marker)) {
      prev = JSON.parse(fs.readFileSync(marker, "utf8"));
    }
    const data = {
      version,
      installedAt: isFirstInstall ? new Date().toISOString() : prev.installedAt,
      updatedAt: new Date().toISOString(),
    };
    fs.writeFileSync(marker, JSON.stringify(data, null, 2), "utf8");
  } catch {
    // 标记文件写入失败不影响启动
  }
}
