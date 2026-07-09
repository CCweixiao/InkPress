export function moveMenuIndex(
  current: number,
  direction: "next" | "previous",
  itemCount: number
): number {
  if (itemCount <= 0) return 0;
  return direction === "next"
    ? Math.min(itemCount - 1, current + 1)
    : Math.max(0, current - 1);
}

export type MentionMenuKeyAction =
  | "next"
  | "previous"
  | "select"
  | "close"
  | "hold";

export function mentionMenuKeyAction(
  key: string,
  loading: boolean
): MentionMenuKeyAction | null {
  if (key === "Escape") return "close";
  if (
    key !== "ArrowDown" &&
    key !== "ArrowUp" &&
    key !== "Enter" &&
    key !== "Tab"
  ) {
    return null;
  }
  if (loading) return "hold";
  if (key === "ArrowDown") return "next";
  if (key === "ArrowUp") return "previous";
  return "select";
}

const MENU_CONTROL_KEYS = new Set([
  "ArrowDown",
  "ArrowUp",
  "Enter",
  "Tab",
  "Escape",
]);

export function shouldNotifyInputOnKeyUp(key: string): boolean {
  return !MENU_CONTROL_KEYS.has(key);
}

export function splitLeadingSlashToken(
  text: string
): { token: string; rest: string } | null {
  const match = text.match(/^(\/[a-zA-Z0-9_-]+)(\s[\s\S]*)$/);
  return match ? { token: match[1], rest: match[2] } : null;
}
