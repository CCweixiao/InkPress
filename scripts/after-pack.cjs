/**
 * electron-builder afterPack 钩子（CommonJS，electron-builder 直接 require）。
 *
 * 问题：server 子进程用主 InkPress 二进制 + ELECTRON_RUN_AS_NODE 启动，
 * macOS LaunchServices 把它注册为同一个 app bundle 的第二个实例，
 * 导致 Dock 出现两个图标。
 *
 * 方案：在 .app bundle 内创建一个子 bundle（Contents/PlugIns/InkPressServer.app），
 * 其 Info.plist 设 LSUIElement=true + LSBackgroundOnly=true（不显示 Dock 图标）。
 * main.ts 的 spawn 用这个子 bundle 的可执行文件，而非主 MacOS/InkPress。
 */
"use strict";
const fs = require("node:fs");
const path = require("node:path");

module.exports = async function afterPack(context) {
  // 仅 macOS
  if (context.electronPlatformName !== "darwin") return;

  const appOutDir = context.appOutDir;

  // appOutDir 可能是 .app 本身，也可能指向父目录；两种情况都兼容
  let appDir = appOutDir;
  let contentsDir = path.join(appDir, "Contents");
  let mainExe = path.join(contentsDir, "MacOS", "InkPress");
  if (!fs.existsSync(mainExe)) {
    const altApp = path.join(appOutDir, "InkPress.app");
    if (fs.existsSync(altApp)) {
      appDir = altApp;
      contentsDir = path.join(appDir, "Contents");
      mainExe = path.join(contentsDir, "MacOS", "InkPress");
    }
  }

  if (!fs.existsSync(mainExe)) {
    console.warn("  ⚠ afterPack: 主二进制不存在，跳过 helper 创建");
    return;
  }

  // 1. 在 PlugIns 下创建子 bundle 目录
  const helperBundleDir = path.join(contentsDir, "PlugIns", "InkPressServer.app");
  const helperContentsDir = path.join(helperBundleDir, "Contents");
  const helperMacOSDir = path.join(helperContentsDir, "MacOS");
  fs.mkdirSync(helperMacOSDir, { recursive: true });

  // 2. 复制主二进制到子 bundle。
  //    必须复制，不能硬链接（fs.linkSync）：硬链接使 helper 与主二进制共享同一 inode，
  //    electron-builder --deep 签名时会对同一文件签名两次，后一次覆盖前一次的封签，
  //    导致 codesign --verify --strict 报 "code has no resources but signature
  //    indicates they must be present"。复制后两份独立文件各自签名，互不干扰。
  const helperExe = path.join(helperMacOSDir, "InkPressServer");
  fs.copyFileSync(mainExe, helperExe);
  fs.chmodSync(helperExe, 0o755);

  // 3. 创建 Frameworks 符号链接指向主 bundle（helper 二进制按 @rpath 在
  //    自己的 Contents/Frameworks/ 下找 Electron Framework，需链接到主 bundle 的副本）。
  //    注：无法用 install_name_tool -add_rpath 替代——Electron 二进制 Mach-O 头部
  //    无填充空间，新增 LC_RPATH 会报 "load commands do not fit"。
  const helperFrameworks = path.join(helperContentsDir, "Frameworks");
  if (!fs.existsSync(helperFrameworks)) {
    fs.symlinkSync(
      path.relative(helperContentsDir, path.join(contentsDir, "Frameworks")),
      helperFrameworks
    );
  }

  // 4. 创建空的 Resources 目录，保证 bundle 结构完整。
  //    codesign 资源封签（CodeResources）要求 bundle 有 Resources 目录，
  //    缺失时 --strict 校验可能判定 "signature indicates resources must be present"。
  fs.mkdirSync(path.join(helperContentsDir, "Resources"), { recursive: true });

  // 5. 写子 bundle 的 Info.plist（LSUIElement + LSBackgroundOnly = 无 Dock 图标）
  const helperPlist = path.join(helperContentsDir, "Info.plist");
  const plistContent = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key>
  <string>InkPressServer</string>
  <key>CFBundleIdentifier</key>
  <string>com.inkpress.app.server</string>
  <key>CFBundleName</key>
  <string>InkPressServer</string>
  <key>CFBundleDisplayName</key>
  <string>InkPress Server</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>1.0.0</string>
  <key>LSUIElement</key>
  <true/>
  <key>LSBackgroundOnly</key>
  <true/>
</dict>
</plist>`;
  fs.writeFileSync(helperPlist, plistContent, "utf8");

  console.log(`  ✓ 创建 LSUIElement helper: ${path.relative(appDir, helperBundleDir)}`);
};
