import { describe, expect, it } from "vitest";
import {
  MAX_TAG_LEN,
  MAX_TAGS,
  validateBatchBody,
  dedupeIds,
  mergeTag,
  removeTag,
  resolvePinToggle,
  diffTagSets,
  applyTagDeltas,
} from "@/lib/snippets/batch-ops";

describe("dedupeIds", () => {
  it("保序去重", () => {
    expect(dedupeIds(["b", "a", "b", "c", "a"])).toEqual(["b", "a", "c"]);
  });
  it("空数组", () => {
    expect(dedupeIds([])).toEqual([]);
  });
});

describe("mergeTag", () => {
  it("新增", () => {
    expect(mergeTag(["a"], "b")).toEqual(["a", "b"]);
  });
  it("已存在原样返回", () => {
    expect(mergeTag(["a", "b"], "a")).toEqual(["a", "b"]);
  });
  it("达上限原样返回", () => {
    const full = Array.from({ length: MAX_TAGS }, (_, i) => `t${i}`);
    expect(mergeTag(full, "new")).toEqual(full);
  });
  it("空白 tag 原样返回", () => {
    expect(mergeTag(["a"], "   ")).toEqual(["a"]);
  });
  it("trim 后追加", () => {
    expect(mergeTag(["a"], "  b  ")).toEqual(["a", "b"]);
  });
  it("标签最多 5 个，单个标签最多 10 字", () => {
    expect(MAX_TAGS).toBe(5);
    expect(MAX_TAG_LEN).toBe(10);
  });
});

describe("removeTag", () => {
  it("移除存在项", () => {
    expect(removeTag(["a", "b", "c"], "b")).toEqual(["a", "c"]);
  });
  it("不存在原样返回", () => {
    expect(removeTag(["a", "b"], "x")).toEqual(["a", "b"]);
  });
});

describe("resolvePinToggle", () => {
  it("全 pinned → 取消置顶", () => {
    expect(resolvePinToggle([{ pinned: true }, { pinned: true }])).toEqual({
      target: false,
      label: "取消置顶",
    });
  });
  it("部分 pinned → 置顶", () => {
    expect(resolvePinToggle([{ pinned: true }, { pinned: false }])).toEqual({
      target: true,
      label: "置顶",
    });
  });
  it("全无 pinned → 置顶", () => {
    expect(resolvePinToggle([{ pinned: false }])).toEqual({
      target: true,
      label: "置顶",
    });
  });
  it("空数组 → 置顶", () => {
    expect(resolvePinToggle([])).toEqual({ target: true, label: "置顶" });
  });
});

describe("diffTagSets", () => {
  it("纯增", () => {
    expect(diffTagSets(["a"], ["a", "b"])).toEqual({ added: ["b"], removed: [] });
  });
  it("纯减", () => {
    expect(diffTagSets(["a", "b"], ["a"])).toEqual({ added: [], removed: ["b"] });
  });
  it("增减并存", () => {
    expect(diffTagSets(["a", "b"], ["b", "c"])).toEqual({
      added: ["c"],
      removed: ["a"],
    });
  });
  it("无变化", () => {
    expect(diffTagSets(["a"], ["a"])).toEqual({ added: [], removed: [] });
  });
});

describe("applyTagDeltas", () => {
  const base = [
    { name: "a", count: 3, color: null as string | null },
    { name: "b", count: 1, color: "red" as string | null },
  ];
  it("正 delta 新增标签", () => {
    const out = applyTagDeltas(base, new Map([["c", 2]]));
    expect(out.find((t) => t.name === "c")).toEqual({
      name: "c",
      count: 2,
      color: null,
    });
  });
  it("负 delta 归零剔除", () => {
    const out = applyTagDeltas(base, new Map([["b", -1]]));
    expect(out.find((t) => t.name === "b")).toBeUndefined();
  });
  it("已有标签增减 count", () => {
    const out = applyTagDeltas(base, new Map([["a", 2]]));
    expect(out.find((t) => t.name === "a")?.count).toBe(5);
  });
  it("排序：count 降序 + name 升序", () => {
    const out = applyTagDeltas(
      [
        { name: "a", count: 1, color: null },
        { name: "b", count: 1, color: null },
      ],
      new Map([["a", 2]])
    );
    expect(out.map((t) => t.name)).toEqual(["a", "b"]);
  });
  it("零/负 delta 不产生新标签", () => {
    const out = applyTagDeltas(base, new Map([["new", -1]]));
    expect(out.find((t) => t.name === "new")).toBeUndefined();
    expect(out.map((t) => t.name)).toEqual(["a", "b"]);
  });
});

describe("validateBatchBody", () => {
  it("delete 合法", () => {
    expect(validateBatchBody({ ids: ["1", "2"], action: "delete" }).ok).toBe(true);
  });
  it("pin 需 pinned", () => {
    expect(validateBatchBody({ ids: ["1"], action: "pin", pinned: true }).ok).toBe(
      true
    );
    expect(validateBatchBody({ ids: ["1"], action: "pin" }).ok).toBe(false);
  });
  it("addTag 需 tag 1-10 字（trim 后）", () => {
    expect(validateBatchBody({ ids: ["1"], action: "addTag", tag: "新标签" }).ok).toBe(
      true
    );
    expect(validateBatchBody({ ids: ["1"], action: "addTag", tag: "   " }).ok).toBe(
      false
    );
    expect(
      validateBatchBody({ ids: ["1"], action: "addTag", tag: "一".repeat(11) }).ok
    ).toBe(false);
  });
  it("ids 上限 50", () => {
    const ids = Array.from({ length: 51 }, (_, i) => `${i}`);
    expect(validateBatchBody({ ids, action: "delete" }).ok).toBe(false);
  });
  it("ids 空数组非法", () => {
    expect(validateBatchBody({ ids: [], action: "delete" }).ok).toBe(false);
  });
  it("action 非法", () => {
    expect(validateBatchBody({ ids: ["1"], action: "weird" }).ok).toBe(false);
  });
  it("tag 经 trim 后回填", () => {
    const r = validateBatchBody({ ids: ["1"], action: "addTag", tag: "  x  " });
    expect(r.ok).toBe(true);
    if (r.ok && r.data.action === "addTag") expect(r.data.tag).toBe("x");
  });
});
