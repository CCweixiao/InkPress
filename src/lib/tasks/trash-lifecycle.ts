export const TRASH_RETENTION_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

export function computeExpiresAt(
  trashedAt: Date,
  retentionDays: number = TRASH_RETENTION_DAYS
): Date {
  return new Date(trashedAt.getTime() + retentionDays * DAY_MS);
}

export function isExpired(expiresAt: Date | null, now: Date = new Date()): boolean {
  if (!expiresAt) return false;
  return expiresAt.getTime() < now.getTime();
}

export function daysLeft(expiresAt: Date | null, now: Date = new Date()): number | null {
  if (!expiresAt) return null;
  const ms = expiresAt.getTime() - now.getTime();
  return Math.max(0, Math.ceil(ms / DAY_MS));
}
