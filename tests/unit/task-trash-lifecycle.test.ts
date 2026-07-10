import { describe, it, expect } from "vitest";
import {
  TRASH_RETENTION_DAYS,
  computeExpiresAt,
  isExpired,
  daysLeft,
} from "@/lib/tasks/trash-lifecycle";

describe("trash-lifecycle", () => {
  const trashedAt = new Date("2026-07-10T00:00:00.000Z");

  it("computeExpiresAt 返回 trashedAt + 30 天", () => {
    const exp = computeExpiresAt(trashedAt);
    expect(exp).toEqual(new Date("2026-08-09T00:00:00.000Z"));
  });

  it("computeExpiresAt 支持自定义 retentionDays", () => {
    const exp = computeExpiresAt(trashedAt, 7);
    expect(exp).toEqual(new Date("2026-07-17T00:00:00.000Z"));
  });

  it("TRASH_RETENTION_DAYS 为 30", () => {
    expect(TRASH_RETENTION_DAYS).toBe(30);
  });

  it("isExpired：过期返回 true", () => {
    const now = new Date("2026-08-10T00:00:00.000Z");
    expect(isExpired(new Date("2026-08-09T00:00:00.000Z"), now)).toBe(true);
  });

  it("isExpired：未过期返回 false", () => {
    const now = new Date("2026-08-08T00:00:00.000Z");
    expect(isExpired(new Date("2026-08-09T00:00:00.000Z"), now)).toBe(false);
  });

  it("isExpired：恰好到期（相等）返回 false（用 < 判断）", () => {
    const now = new Date("2026-08-09T00:00:00.000Z");
    expect(isExpired(new Date("2026-08-09T00:00:00.000Z"), now)).toBe(false);
  });

  it("isExpired：null 永不过期", () => {
    expect(isExpired(null, new Date())).toBe(false);
  });

  it("daysLeft：剩余 18 天", () => {
    const now = new Date("2026-07-22T00:00:00.000Z");
    const exp = new Date("2026-08-09T00:00:00.000Z");
    expect(daysLeft(exp, now)).toBe(18);
  });

  it("daysLeft：向上取整（剩余 17.5 天 → 18）", () => {
    const now = new Date("2026-07-22T12:00:00.000Z");
    const exp = new Date("2026-08-09T00:00:00.000Z");
    expect(daysLeft(exp, now)).toBe(18);
  });

  it("daysLeft：已过期返回 0", () => {
    const now = new Date("2026-08-10T00:00:00.000Z");
    const exp = new Date("2026-08-09T00:00:00.000Z");
    expect(daysLeft(exp, now)).toBe(0);
  });

  it("daysLeft：null 返回 null", () => {
    expect(daysLeft(null, new Date())).toBe(null);
  });
});
