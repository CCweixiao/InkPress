import { describe, it, expect } from "vitest";
import { taskToSearchResultItem } from "@/lib/tasks/search-result";

const base = {
  id: "t1",
  title: "完成产品介绍文章初稿",
  content: "",
  status: "todo" as const,
  priority: 3 as const,
  dueDate: "2026-07-20T08:00:00.000Z",
  dueTime: null,
  isAllDay: true,
  completedAt: null,
  parentId: null,
  spaceId: null,
  sortOrder: 0,
  tagsJson: "[]",
  isCollapsed: false,
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-09T00:00:00.000Z",
};

describe("taskToSearchResultItem", () => {
  it("title 取 task.title；subtitle 含状态标签 + 截止日", () => {
    const r = taskToSearchResultItem(base);
    expect(r.id).toBe("t1");
    expect(r.title).toBe("完成产品介绍文章初稿");
    expect(r.subtitle).toContain("待办");
    expect(r.subtitle).toContain("7月20日");
    expect(r.href).toBe("/tasks");
  });

  it("空 title → 用「无标题任务」兜底", () => {
    const r = taskToSearchResultItem({ ...base, title: "" });
    expect(r.title).toBe("无标题任务");
  });

  it("priority=4 → subtitle 含「紧急」", () => {
    const r = taskToSearchResultItem({ ...base, priority: 4 });
    expect(r.subtitle).toContain("紧急");
  });

  it("status=done → subtitle 含「已完成」", () => {
    const r = taskToSearchResultItem({ ...base, status: "done" });
    expect(r.subtitle).toContain("已完成");
  });

  it("status=cancelled → subtitle 含「已取消」", () => {
    const r = taskToSearchResultItem({ ...base, status: "cancelled" });
    expect(r.subtitle).toContain("已取消");
  });

  it("dueDate=null → subtitle 不含日期段", () => {
    const r = taskToSearchResultItem({ ...base, dueDate: null });
    expect(r.subtitle).not.toContain("月");
  });

  it("href 恒为 /tasks", () => {
    expect(taskToSearchResultItem(base).href).toBe("/tasks");
  });
});
