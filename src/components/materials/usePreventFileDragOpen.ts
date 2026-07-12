import { useEffect } from "react";

/**
 * 阻止浏览器默认的文件拖拽行为（导航到文件 / 播放视频等）。
 *
 * 问题：只有调用了 dragover.preventDefault() 的元素才允许 drop，
 * 但拖拽过程中鼠标经过页面其他区域时浏览器仍会准备「打开文件」，
 * 不慎释放在非 drop 目标上 → 浏览器导航到文件 / 播放视频。
 *
 * 方案：在 window 上统一 preventDefault dragover 和 drop，
 * 浏览器永远不会打开文件。组件级 onDrop 正常触发（React 合成事件独立冒泡，
 * 且 preventDefault 不阻止冒泡）。
 */
export function usePreventFileDragOpen(enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    const preventDefaults = (e: DragEvent) => {
      e.preventDefault();
    };
    window.addEventListener("dragover", preventDefaults);
    window.addEventListener("drop", preventDefaults);
    return () => {
      window.removeEventListener("dragover", preventDefaults);
      window.removeEventListener("drop", preventDefaults);
    };
  }, [enabled]);
}
