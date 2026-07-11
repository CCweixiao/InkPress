import { describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";

import { POST as tagsPOST } from "@/app/api/tags/route";
import { PATCH as tagPATCH, DELETE as tagDELETE } from "@/app/api/tags/[id]/route";

// Helper: create a NextRequest with JSON body
function jsonReq(url: string, body: unknown, method = "POST"): NextRequest {
  return new NextRequest(`http://localhost${url}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("tags hierarchy API", () => {
  beforeEach(async () => {
    await prisma.taskTag.deleteMany();
    await prisma.tag.updateMany({ where: { parentId: { not: null } }, data: { parentId: null } });
    await prisma.tag.deleteMany();
  });

  it("POST 创建一级 tag（无 parentId）", async () => {
    const res = await tagsPOST(jsonReq("/api/tags", { name: "工作", color: "#ef4444" }));
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.tag.parentId).toBeNull();
    expect(data.tag.color).toBe("#ef4444");
  });

  it("POST 创建二级 tag（合法 parentId）", async () => {
    const parent = await tagsPOST(jsonReq("/api/tags", { name: "生活" }));
    const parentData = await parent.json();
    const child = await tagsPOST(jsonReq("/api/tags", { name: "健身", parentId: parentData.tag.id }));
    expect(child.status).toBe(201);
    const childData = await child.json();
    expect(childData.tag.parentId).toBe(parentData.tag.id);
  });

  it("POST 三级嵌套 → 400", async () => {
    const lv1 = await tagsPOST(jsonReq("/api/tags", { name: "生活" }));
    const lv1Data = await lv1.json();
    const lv2 = await tagsPOST(jsonReq("/api/tags", { name: "健身", parentId: lv1Data.tag.id }));
    const lv2Data = await lv2.json();
    const lv3 = await tagsPOST(jsonReq("/api/tags", { name: "深蹲", parentId: lv2Data.tag.id }));
    expect(lv3.status).toBe(400);
  });

  it("PATCH 移动：二级 → 一级（parentId=null）", async () => {
    const parent = await tagsPOST(jsonReq("/api/tags", { name: "生活" }));
    const parentData = await parent.json();
    const child = await tagsPOST(jsonReq("/api/tags", { name: "健身", parentId: parentData.tag.id }));
    const childData = await child.json();
    const res = await tagPATCH(
      jsonReq(`/api/tags/${childData.tag.id}`, { parentId: null }, "PATCH"),
      { params: Promise.resolve({ id: childData.tag.id }) },
    );
    expect(res.status).toBe(200);
    const updated = await res.json();
    expect(updated.tag.parentId).toBeNull();
  });

  it("PATCH 自引用 → 400", async () => {
    const t = await tagsPOST(jsonReq("/api/tags", { name: "工作" }));
    const tData = await t.json();
    const res = await tagPATCH(
      jsonReq(`/api/tags/${tData.tag.id}`, { parentId: tData.tag.id }, "PATCH"),
      { params: Promise.resolve({ id: tData.tag.id }) },
    );
    expect(res.status).toBe(400);
  });

  it("DELETE 一级 tag：子标签提升为一级", async () => {
    const parent = await tagsPOST(jsonReq("/api/tags", { name: "生活" }));
    const parentData = await parent.json();
    const child = await tagsPOST(jsonReq("/api/tags", { name: "健身", parentId: parentData.tag.id }));
    const childData = await child.json();

    const res = await tagDELETE(
      new NextRequest(`http://localhost/api/tags/${parentData.tag.id}`, { method: "DELETE" }),
      { params: Promise.resolve({ id: parentData.tag.id }) },
    );
    expect(res.status).toBe(200);

    const orphan = await prisma.tag.findUnique({ where: { id: childData.tag.id } });
    expect(orphan?.parentId).toBeNull();
  });
});
