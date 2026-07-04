/**
 * Bytecode 编译脚本：在 Electron 环境下用 bytenode 把 server.js 编译为 server.jsc。
 *
 * 必须在 ELECTRON_RUN_AS_NODE=1 下用 Electron 二进制执行，确保编译期 V8 版本
 * 与运行时一致（Electron 42 → V8 14.8.x）。若用系统 Node 22（V8 12.4.x）编译，
 * 加载 .jsc 会报 ERR_INVALID_BYTECODE（V8 字节码跨版本不兼容）。
 *
 * 用法：ELECTRON_RUN_AS_NODE=1 electron scripts/compile-bytecode.cjs /abs/path/to/server.js
 *
 * bytenode 1.6.0 要点：
 * - require('bytenode') 在注册 .jsc handler 的同时设置 V8 flags（--no-lazy,
 *   --no-flush-bytecode），与运行时 loader 加载 .jsc 时设置的 flags 一致，
 *   确保 bytecode 格式兼容（Electron 42 / V8 14.8+ 必需）。
 * - compileFile 不带 electron/electronMain 标志时走 compileCode（同步、当前进程），
 *   使用当前进程的 V8 引擎——正是我们需要的 Electron V8 14.8.x。
 *
 * 步骤：
 * 1. require('bytenode') 注册 .jsc handler + 设置 V8 flags
 * 2. compileFile({ filename, output }) 编译 server.js → server.jsc
 * 3. 计算 server.jsc 的 SHA-256 写入 server.jsc.sha256（运行时完整性校验用）
 * 4. 覆写 server.js 为薄加载器：require('bytenode'); module.exports = require('./server.jsc');
 * 5. 失败时 exit(1)，由调用方（prepare-standalone.ts）决定是否回退明文
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const serverJs = process.argv[2];
if (!serverJs || !fs.existsSync(serverJs)) {
  console.error(`✗ compile-bytecode: 缺少 server.js 参数或文件不存在: ${serverJs || '(undefined)'}`);
  process.exit(1);
}

const jscPath = serverJs + 'c'; // server.js → server.jsc
const sha256Path = jscPath + '.sha256';

(async () => {
  try {
    // require('bytenode') 同时：注册 .jsc handler + 设置 --no-lazy / --no-flush-bytecode
    const bytenode = require('bytenode');

    // compileFile 不带 electron/electronMain 标志 → compileCode 在当前进程同步编译。
    // 当前进程已在 ELECTRON_RUN_AS_NODE=1 下用 Electron 启动，V8 = 14.8.x，与运行时一致。
    await bytenode.compileFile({
      filename: serverJs,
      output: jscPath,
      compileAsModule: true, // Module.wrap 包裹（默认 true，与运行时 loader 期望一致）
    });

    if (!fs.existsSync(jscPath)) {
      throw new Error(`编译后 ${jscPath} 不存在`);
    }

    // SHA-256 用于运行时完整性校验
    const jscBuf = fs.readFileSync(jscPath);
    const hash = crypto.createHash('sha256').update(jscBuf).digest('hex');
    fs.writeFileSync(sha256Path, hash, 'utf8');

    // 覆写 server.js 为薄加载器（cwd 为 standalone 目录，require 解析天然工作）
    // 与 bytenode 官方 loaderCodeCommonJS 一致：module.exports = require(...) 确保导出传播
    const loader = "require('bytenode');\nmodule.exports = require('./server.jsc');\n";
    fs.writeFileSync(serverJs, loader, 'utf8');

    const sizeMB = (jscBuf.length / 1024 / 1024).toFixed(1);
    console.log(`  ✓ server.jsc 编译成功（${sizeMB} MB）`);
    console.log(`  ✓ SHA-256: ${hash.slice(0, 16)}…`);
  } catch (err) {
    console.error(`✗ compile-bytecode 失败: ${(err && err.stack) || err}`);
    process.exit(1);
  }
})();
