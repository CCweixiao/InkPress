/**
 * 「未分组」虚拟列的排序位置持久化（localStorage，无 schema 变更）。
 *
 * 看板自定义模式下，真实分组（TaskSection）有 DB sortOrder 字段；
 * 但「未分组」是虚拟列（sectionId=null 的任务），没有 DB 记录，
 * 所以它的位置存在 localStorage 里，按 listId 隔离。
 */

const STORAGE_KEY = "inkpress.ungroupedPositions";

/** 读取所有 list 的 ungrouped 位置映射 */
function readAll(): Record<string, number> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, number>) : {};
  } catch {
    return {};
  }
}

/** 获取指定 list 的 ungrouped 列位置索引；未设置时返回末尾（-1 哨兵）。 */
export function getUngroupedPosition(listId: string): number {
  const all = readAll();
  const pos = all[listId];
  return typeof pos === "number" ? pos : -1;
}

/** 设置指定 list 的 ungrouped 列位置索引 */
export function setUngroupedPosition(listId: string, position: number): void {
  if (typeof window === "undefined") return;
  try {
    const all = readAll();
    all[listId] = position;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    /* ignore quota errors */
  }
}
