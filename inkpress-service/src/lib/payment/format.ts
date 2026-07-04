/** 金额（分）→ 元的展示字符串（保留 2 位小数） */
export function centsToYuan(cents: number): string {
  return (cents / 100).toFixed(2);
}

/** 金额（分）→ ¥X.XX 形式 */
export function formatYuan(cents: number): string {
  return `¥${centsToYuan(cents)}`;
}
