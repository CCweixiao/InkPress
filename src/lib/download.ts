/**
 * 浏览器端文件下载工具。
 *
 * 标准 Blob + a.download 实现：生成临时 URL → 触发点击 → 回收 URL。
 * 文件落到浏览器默认下载位置（由用户系统设置决定）。
 */
export function downloadText(
  filename: string,
  content: string,
  mime = "application/json"
): void {
  const blob = new Blob([content], { type: mime });
  downloadBlob(filename, blob);
}

/**
 * 下载二进制 Blob（如服务端返回的 ZIP）。与 downloadText 同样的创建/回收流程。
 */
export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  // 回收：移除 DOM 节点 + 释放对象 URL，避免内存泄漏
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
