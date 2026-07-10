import { describe, it, expect } from "vitest";
import { isToday, isNext7Days, isInbox, filterBySmartView } from "@/lib/tasks/smart-views";
import type { Task } from "@/components/tasks/types";

const NOW = new Date("2026-07-14T10:00:00.000Z"); // 2026-07-14 Tuesday

function makeTask(overrides: Partial<Task>): Task {
  return {
    id: "t1",
    title: "x",
    content: "",
    status: "todo",
    priority: 0,
    dueDate: null,
    dueTime: null,
    isAllDay: true,
    completedAt: null,
    parentId: null,
    spaceId: null,
    sortOrder: 0,
    tagsJson: "[]",
    tags: [],
    isCollapsed: false,
    trashed: false,
    trashedAt: null,
    expiresAt: null,
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("isToday", () => {
  it("dueDate 落在今天 → true", () => {
    const t = makeTask({ dueDate: "2026-07-14T08:00:00.000Z" });
    expect(isToday(t, NOW)).toBe(true);
  });
  it("dueDate 是昨天 → false", () => {
    const t = makeTask({ dueDate: "2026-07-13T23:59:00.000Z" });
    expect(isToday(t, NOW)).toBe(false);
  });
  it("dueDate 是明天 → false", () => {
    const t = makeTask({ dueDate: "2026-07-15T00:00:00.000Z" });
    expect(isToday(t, NOW)).toBe(false);
  });
  it("dueDate 为空 → false", () => {
    expect(isToday(makeTask({}), NOW)).toBe(false);
  });
  it("status=done 但 completedAt 是今天 → true（今日已完成也归入今天视图）", () => {
    const t = makeTask({ status: "done", completedAt: "2026-07-14T09:00:00.000Z" });
    expect(isToday(t, NOW)).toBe(true);
  });
  it("status=cancelled → 永远 false（已取消不计入）", () => {
    const t = makeTask({ status: "cancelled", dueDate: "2026-07-14T08:00:00.000Z" });
    expect(isToday(t, NOW)).toBe(false);
  });
});

describe("isNext7Days", () => {
  it("dueDate 在 3 天后 → true", () => {
    const t = makeTask({ dueDate: "2026-07-17T12:00:00.000Z" });
    expect(isNext7Days(t, NOW)).toBe(true);
  });
  it("dueDate 是今天 → true（区间含起点）", () => {
    const t = makeTask({ dueDate: "2026-07-14T20:00:00.000Z" });
    expect(isNext7Days(t, NOW)).toBe(true);
  });
  it("dueDate 是今天+7 整 → true（区间含终点 7 天后 23:59）", () => {
    const t = makeTask({ dueDate: "2026-07-21T10:00:00.000Z" });
    expect(isNext7Days(t, NOW)).toBe(true);
  });
  it("dueDate 是今天+8 → false", () => {
    const t = makeTask({ dueDate: "2026-07-22T10:00:00.000Z" });
    expect(isNext7Days(t, NOW)).toBe(false);
  });
  it("dueDate 是昨天 → false（已过期不算未来 7 天）", () => {
    const t = makeTask({ dueDate: "2026-07-13T10:00:00.000Z" });
    expect(isNext7Days(t, NOW)).toBe(false);
  });
  it("status=cancelled → false", () => {
    const t = makeTask({ status: "cancelled", dueDate: "2026-07-17T12:00:00.000Z" });
    expect(isNext7Days(t, NOW)).toBe(false);
  });
});

describe("isInbox", () => {
  it("spaceId=null 且未完成 → true", () => {
    expect(isInbox(makeTask({ spaceId: null, status: "todo" }))).toBe(true);
  });
  it("spaceId 有值 → false", () => {
    expect(isInbox(makeTask({ spaceId: "s1", status: "todo" }))).toBe(false);
  });
  it("status=done → false（已完成不进收集箱）", () => {
    expect(isInbox(makeTask({ spaceId: null, status: "done" }))).toBe(false);
  });
  it("status=archived → false", () => {
    expect(isInbox(makeTask({ spaceId: null, status: "archived" }))).toBe(false);
  });
  it("status=cancelled → false", () => {
    expect(isInbox(makeTask({ spaceId: null, status: "cancelled" }))).toBe(false);
  });
});

describe("filterBySmartView", () => {
  const tasks: Task[] = [
    makeTask({ id: "a", spaceId: "s1", dueDate: "2026-07-14T08:00:00.000Z" }), // today (has space, not inbox)
    makeTask({ id: "b", spaceId: "s1", dueDate: "2026-07-17T08:00:00.000Z" }), // next7 (has space, not inbox)
    makeTask({ id: "c", spaceId: "s1" }), // neither inbox (has space)
    makeTask({ id: "d", spaceId: null, status: "todo" }), // inbox
    makeTask({ id: "e", status: "cancelled", dueDate: "2026-07-14T08:00:00.000Z" }), // cancelled
  ];

  it("today → 只留 a", () => {
    const r = filterBySmartView(tasks, "today", NOW);
    expect(r.map((t) => t.id)).toEqual(["a"]);
  });
  it("next7days → 留 a 和 b", () => {
    const r = filterBySmartView(tasks, "next7days", NOW);
    expect(r.map((t) => t.id).sort()).toEqual(["a", "b"]);
  });
  it("inbox → 只留 d", () => {
    const r = filterBySmartView(tasks, "inbox", NOW);
    expect(r.map((t) => t.id)).toEqual(["d"]);
  });
});

describe("filterBySmartView trashed 过滤", () => {
  const now = new Date("2026-07-10T12:00:00.000Z");
  const todayTask = {
    id: "t1",
    status: "todo",
    dueDate: "2026-07-10T12:00:00.000Z",
    completedAt: null,
    spaceId: null,
    trashed: true,
  } as any;

  it("trashed 任务即使 dueDate 在今天也不进入 today 视图", () => {
    expect(filterBySmartView([todayTask], "today", now)).toEqual([]);
  });

  it("trashed 任务不进入 next7days 视图", () => {
    expect(filterBySmartView([todayTask], "next7days", now)).toEqual([]);
  });

  it("trashed 任务不进入 inbox 视图", () => {
    expect(filterBySmartView([todayTask], "inbox", now)).toEqual([]);
  });
});
