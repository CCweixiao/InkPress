/**
 * 清单图标偏好（emoji）— 纯前端 localStorage 持久化，不依赖 DB schema。
 * 通过 listId → emoji 映射，在侧边栏、对话框预览中展示。
 */

const STORAGE_KEY = "inkpress.listIcons";

/** 默认 emoji（清单未设置时回退）。 */
export const DEFAULT_LIST_EMOJI = "📋";

/** 精选 emoji 图标集（任务清单常用语义）。 */
export const LIST_EMOJI_PRESETS: string[] = [
  "✅", "🎯", "⭐", "❤️", "💼",
  "📚", "🚀", "🏠", "🛒", "💡", "🎨",
  "🏃", "🍳", "✈️", "🎵", "💪", "🌱",
  "🔥", "⏰", "📌", "🎁", "💰", "🎓",
];

function readMap(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function writeMap(map: Record<string, string>) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    /* ignore quota errors */
  }
}

/** 获取某个清单的 emoji，未设置返回默认值。 */
export function getListEmoji(listId: string): string {
  return readMap()[listId] ?? DEFAULT_LIST_EMOJI;
}

/** 获取多个清单的 emoji 映射（批量读取，减少 IO）。 */
export function getAllListEmojis(): Record<string, string> {
  return readMap();
}

/** 设置某个清单的 emoji。传 null 清除。 */
export function setListEmoji(listId: string, emoji: string | null) {
  const map = readMap();
  if (emoji === null) {
    delete map[listId];
  } else {
    map[listId] = emoji;
  }
  writeMap(map);
  notifyListIconsChanged();
}

/** 订阅图标变更（跨组件同步，基于 storage 事件 + 自定义事件）。 */
export function subscribeListIcons(callback: () => void): () => void {
  const handler = () => callback();
  window.addEventListener("storage", handler);
  window.addEventListener("inkpress:list-icons-changed", handler);
  return () => {
    window.removeEventListener("storage", handler);
    window.removeEventListener("inkpress:list-icons-changed", handler);
  };
}

/** 内部写入后派发变更事件（setListEmoji 已自动派发，此处供外部手动触发）。 */
export function notifyListIconsChanged() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event("inkpress:list-icons-changed"));
}
