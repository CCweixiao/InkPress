/**
 * Next.js instrumentation：Node server 运行时启动时执行一次（Edge runtime 下不执行）。
 *
 * 用于桌面应用首次启动初始化（建表 + seed 主题）。
 * 此处运行在标准 Node 运行时（Electron 通过 ELECTRON_RUN_AS_NODE spawn 的 server 进程），
 * 可原生加载 better-sqlite3，规避 Electron 主进程的 Node ABI 冲突。
 *
 * 开发模式下 ensureDataHome() 直接返回（用项目目录的 dev.db）。
 */
export async function register() {
  // 仅在 nodejs runtime 执行（instrumentation 也会在 edge 调用）
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { ensureDataHome } = await import("./lib/init");
    const { moduleLogger } = await import("./lib/logger");
    const log = moduleLogger("instrumentation");
    try {
      await ensureDataHome();
      log.info("数据目录初始化完成");
    } catch (e) {
      // 初始化失败不阻塞启动，但记录错误
      log.error({ err: e }, "数据目录初始化失败");
    }

    // 全局异常兜底：捕获未处理的 Promise 拒绝与未捕获异常，写入日志。
    // 避免这些错误静默丢失（Next.js 默认只在控制台打印，不落日志文件）。
    process.on("unhandledRejection", (reason) => {
      log.fatal(
        { err: reason instanceof Error ? reason : { reason: String(reason) } },
        "未处理的 Promise 拒绝（unhandledRejection）"
      );
    });
    process.on("uncaughtException", (err) => {
      log.fatal({ err }, "未捕获异常（uncaughtException）");
      // 不主动 exit：让 Next.js / Node 默认行为接管，仅确保日志已落盘
    });
  }
}
