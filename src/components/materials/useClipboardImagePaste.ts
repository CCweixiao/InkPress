"use client";

import { useEffect, useRef, type RefObject } from "react";

// ────────────────────────────────────────────────────────────────────────────
// 素材库剪切板图片粘贴：可复用 hook + 纯函数工具。
//
// 设计要点：
// - 仅拦截图片：剪贴板含 `kind==="file" && type.startsWith("image/")` 才 preventDefault
//   并回调；文本/HTML 粘贴原样放行，绝不破坏描述框/标题/搜索/文章编辑器的正常粘贴。
// - scope="document"：绑 document（素材页整页生效）。
// - scope="element"：绑 targetRef.current（编辑器侧面板用，配合 tabIndex={-1} 让 div
//   可聚焦；这样粘贴只在面板区域生效，不会与 Tiptap 文章编辑器自带的图片粘贴打架）。
// - cbRef 模式：onPaste 存 ref，effect 只依赖 [enabled, scope, targetRef]，避免父级
//   每次重渲染都重绑监听器。
// ────────────────────────────────────────────────────────────────────────────

type UseClipboardImagePasteOptions = {
  /** 是否启用（弹窗打开时宿主传 !uploadOpen，由弹窗内部监听器独占）。默认 true。 */
  enabled?: boolean;
  /** document = 整页；element = 仅 targetRef 子树（需配合 tabIndex）。 */
  scope: "document" | "element";
  /** 命中图片粘贴时回调（已做泛名改写）。 */
  onPaste: (files: File[]) => void;
};

/** contentType（image/*）→ 扩展名（无点）。未知图片类型默认 png。 */
function extFromImageType(type: string): string {
  const map: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/gif": "gif",
    "image/webp": "webp",
    "image/svg+xml": "svg",
    "image/bmp": "bmp",
    "image/x-icon": "ico",
  };
  const key = type.split(";")[0].trim().toLowerCase();
  return map[key] ?? "png";
}

/**
 * 为匿名剪切板图片生成可读展示名：`paste-YYYYMMDD-HHmmss-<6hex>.<ext>`。
 * 仅用于弹窗内任务列表展示；服务端 genAssetName 仍生成规范短 UUID 名。
 * now 默认 new Date()，在事件处理期内构造（非模块作用域），时区安全（本地时间，仅展示）。
 */
export function buildPastedImageName(type: string, now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const y = now.getFullYear();
  const mo = pad(now.getMonth() + 1);
  const d = pad(now.getDate());
  const h = pad(now.getHours());
  const mi = pad(now.getMinutes());
  const s = pad(now.getSeconds());
  // 6 位十六进制：同一秒内区分多张，纯展示用，无需密码学强度。
  const suffix = Math.random().toString(16).slice(2, 8).padStart(6, "0");
  return `paste-${y}${mo}${d}-${h}${mi}${s}-${suffix}.${extFromImageType(type)}`;
}

/** 判断剪切板图片文件名是否为「泛名」（需改写）。mac 截图常带可读名（如「截屏2026-...」）应保留。 */
export function isGenericImageName(name: string): boolean {
  if (!name) return true;
  return /^image\.[a-z0-9]+$/i.test(name.trim());
}

/** File.name 只读，需重建 File 以改写文件名（保留 type / lastModified）。 */
export function rehydrateWithFriendlyName(file: File, name: string): File {
  return new File([file], name, {
    type: file.type,
    lastModified: file.lastModified,
  });
}

/**
 * 从 ClipboardEvent.clipboardData 提取图片文件。
 * 仅 kind==="file" && type.startsWith("image/") 的 item；非图片（文本/HTML/其他文件）忽略。
 */
export function extractImageFiles(clipboardData: DataTransfer | null): File[] {
  if (!clipboardData) return [];
  const out: File[] = [];
  // Array.from 兼容类数组；部分浏览器 items 可能为 undefined。
  const items = Array.from(clipboardData.items ?? []);
  for (const item of items) {
    if (item.kind === "file" && item.type.startsWith("image/")) {
      const file = item.getAsFile();
      if (file) out.push(file);
    }
  }
  return out;
}

/**
 * 命中图片时把泛名改写为可读名（带可读名的保留原样）。
 * 提取自 hook 逻辑，导出便于单测。
 */
export function normalizePastedImages(files: File[]): File[] {
  return files.map((file) =>
    isGenericImageName(file.name)
      ? rehydrateWithFriendlyName(file, buildPastedImageName(file.type))
      : file
  );
}

/** 平台探测：供 ⌘/Ctrl 提示文案。navigator.platform 仍被所有主流浏览器支持。 */
export function isMacPlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Mac/i.test(navigator.platform);
}

/** 返回平台对应的粘贴快捷键文案（⌘V 或 Ctrl+V）。 */
export function pasteShortcutLabel(): string {
  return isMacPlatform() ? "⌘V" : "Ctrl+V";
}

/**
 * 绑定剪切板图片粘贴监听器。
 *
 * - targetRef：scope="element" 时监听该元素（需可聚焦，配合 tabIndex={-1}）；
 *   scope="document" 时忽略（监听 document），可传 null。
 * - 命中图片 → preventDefault + onPaste(已改写泛名的 File[])；
 *   否则什么都不做，文本/HTML 粘贴正常放行。
 */
export function useClipboardImagePaste(
  targetRef: RefObject<HTMLElement | null> | null,
  { enabled = true, scope, onPaste }: UseClipboardImagePasteOptions
): void {
  // cbRef：让绑定 effect 不依赖 onPaste 身份，避免父级重渲染导致重绑监听器。
  // 最新值在 effect 内同步（render 期写 ref 会被 react-hooks 规则拦截）。
  const cbRef = useRef(onPaste);
  useEffect(() => {
    cbRef.current = onPaste;
  });

  useEffect(() => {
    if (!enabled) return;
    const target = scope === "element" ? targetRef?.current ?? null : document;
    if (!target) return;

    const handler = (event: ClipboardEvent) => {
      const files = extractImageFiles(event.clipboardData);
      if (files.length === 0) return; // 非图片：放行，不干预默认行为
      event.preventDefault();
      cbRef.current(normalizePastedImages(files));
    };

    // target 是 Document | HTMLElement 的联合，addEventListener 重载无法统一推导出
    // ClipboardEvent 形参，统一按 EventListener 注册（handler 仍是同一引用，可正确解绑）。
    target.addEventListener("paste", handler as EventListener);
    return () => target.removeEventListener("paste", handler as EventListener);
  }, [enabled, scope, targetRef]);
}

// ────────────────────────────────────────────────────────────────────────────
// 主动读剪贴板（Clipboard API）：弹窗打开时尝试读取「当前」剪贴板里的图片。
//
// 与 paste 监听的区别：paste 需要用户按 ⌘V；本 hook 在 enabled 翻为 true（弹窗打开）
// 时主动读一次，若有图片则回调，省掉一次 ⌘V。
//
// 浏览器限制（必须 graceful fallback）：
// - 只能读「当前最新一条」剪贴板，拿不到 OS 历史；
// - 需用户手势 + clipboard-read 权限（Chrome/Safari 首次会弹询问，允许后该站点不再询问）；
// - Firefox 对 image 读取支持差 → 走 catch 静默回落到 paste。
// 故任何异常（不支持 / 拒绝 / 非图片）都静默，绝不阻塞用户。
// ────────────────────────────────────────────────────────────────────────────

type UseProactiveClipboardReadOptions = {
  /** 通常传 open；翻为 true 时读一次，翻回 false 时重置以便下次再读。 */
  enabled: boolean;
  /** 读到图片时回调（已生成可读名）。 */
  onImage: (file: File) => void;
};

export function useProactiveClipboardRead({
  enabled,
  onImage,
}: UseProactiveClipboardReadOptions): void {
  const cbRef = useRef(onImage);
  useEffect(() => {
    cbRef.current = onImage;
  });
  // 每次开启周期只读一次（避免轮询 / 重复抓同一张）。
  const ranRef = useRef(false);

  useEffect(() => {
    if (!enabled) {
      ranRef.current = false; // 关闭后重置，下次打开再读
      return;
    }
    if (ranRef.current) return;
    ranRef.current = true;

    const read = async () => {
      // 不支持 Clipboard API / 无 read 方法 → 静默回落。
      const nav = navigator as Navigator & {
        clipboard?: { read?: () => Promise<ClipboardItems> };
      };
      if (!nav.clipboard?.read) return;
      try {
        const items = await nav.clipboard.read();
        for (const item of items) {
          const imageType = item.types.find((t) => t.startsWith("image/"));
          if (!imageType) continue;
          const blob = await item.getType(imageType);
          const file = new File([blob], buildPastedImageName(imageType), {
            type: imageType,
            lastModified: Date.now(),
          });
          cbRef.current(file);
          return; // 只取第一张图片
        }
      } catch {
        // NotAllowedError / SecurityError / 其它：静默回落到 paste。
      }
    };
    void read();
  }, [enabled]);
}
