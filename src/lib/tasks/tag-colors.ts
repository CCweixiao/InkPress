export const PRESET_TAG_COLORS = [
  "#6b7280", // 灰（默认）
  "#3b82f6", // 蓝
  "#22c55e", // 绿
  "#f59e0b", // 黄
  "#ef4444", // 红
  "#8b5cf6", // 紫
  "#ec4899", // 粉
  "#14b8a6", // 青
] as const;

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

export function normalizeColor(hex: string): string {
  return HEX_RE.test(hex) ? hex : PRESET_TAG_COLORS[0];
}
