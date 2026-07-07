import { describe, expect, it } from "vitest";
import { serializeComposer } from "../../src/lib/ai/snippet-serialize";

describe("serializeComposer", () => {
  it("空 refs → message=text，无标记段", () => {
    expect(serializeComposer("你好", [])).toEqual({ message: "你好", snippetRefs: [] });
  });

  it("有 refs → message 含按序 {{snippet:id}} + snippetRefs id 数组", () => {
    const r = serializeComposer("帮我写文章", ["cl1", "cl2"]);
    expect(r.snippetRefs).toEqual(["cl1", "cl2"]);
    expect(r.message.startsWith("帮我写文章")).toBe(true);
    expect(r.message).toContain("<!-- snippet-refs -->");
    expect(r.message).toContain("{{snippet:cl1}} {{snippet:cl2}}");
  });

  it("重复 id 去重（保持首次出现顺序）", () => {
    const r = serializeComposer("x", ["cl1", "cl2", "cl1"]);
    expect(r.snippetRefs).toEqual(["cl1", "cl2"]);
    const markers = r.message.match(/\{\{snippet:cl\d\}\}/g) ?? [];
    expect(markers).toEqual(["{{snippet:cl1}}", "{{snippet:cl2}}"]);
  });

  it("text 为空但有 refs → 仍生成标记段，且不以换行开头", () => {
    const r = serializeComposer("", ["cl1"]);
    expect(r.message).toBe("<!-- snippet-refs -->\n{{snippet:cl1}}");
    expect(r.snippetRefs).toEqual(["cl1"]);
  });

  it("text 尾部已有换行 → 不产生多余空行（至多一个空行）", () => {
    const r = serializeComposer("你好\n", ["cl1"]);
    expect(r.message).toBe("你好\n\n<!-- snippet-refs -->\n{{snippet:cl1}}");
    expect(r.message.includes("\n\n\n")).toBe(false);
  });

  it("过滤 falsy id", () => {
    const r = serializeComposer("x", ["cl1", "", "cl2"]);
    expect(r.snippetRefs).toEqual(["cl1", "cl2"]);
  });
});
