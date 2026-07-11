import { describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { DEFAULT_LIST_ID } from "@/lib/tasks/list-repo";

// Route handlers
import { GET as foldersGET, POST as foldersPOST } from "@/app/api/tasks/folders/route";
import { PATCH as folderPATCH, DELETE as folderDELETE } from "@/app/api/tasks/folders/[id]/route";
import { POST as foldersReorderPOST } from "@/app/api/tasks/folders/reorder/route";
import { POST as listsPOST } from "@/app/api/tasks/lists/route";
import { PATCH as listPATCH, DELETE as listDELETE } from "@/app/api/tasks/lists/[id]/route";
import { POST as listsReorderPOST } from "@/app/api/tasks/lists/reorder/route";

// Helper: create a NextRequest with JSON body
function jsonReq(url: string, body: unknown, method = "POST"): NextRequest {
  return new NextRequest(`http://localhost${url}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("folders & lists API", () => {
  beforeEach(async () => {
    await prisma.task.deleteMany();
    await prisma.taskList.deleteMany();
    // Re-seed default list (deleted by deleteMany above)
    await prisma.taskList.upsert({
      where: { id: DEFAULT_LIST_ID },
      create: {
        id: DEFAULT_LIST_ID,
        name: "默认清单",
        color: "#6b7280",
        folderId: null,
        sortOrder: 0,
      },
      update: {},
    });
    await prisma.taskFolder.deleteMany();
  });

  // --- GET full tree ---

  it("GET /api/tasks/folders returns empty tree initially", async () => {
    const res = await foldersGET();
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.folders).toHaveLength(0);
    expect(json.standaloneLists).toHaveLength(1); // default list
    expect(json.standaloneLists[0].id).toBe(DEFAULT_LIST_ID);
  });

  // --- POST folder ---

  it("POST /api/tasks/folders creates a folder", async () => {
    const res = await foldersPOST(jsonReq("/api/tasks/folders", { name: "工作" }));
    const json = await res.json();
    expect(res.status).toBe(201);
    expect(json.folder.name).toBe("工作");
    expect(json.folder.id).toBeTruthy();
  });

  it("POST /api/tasks/folders rejects empty name", async () => {
    const res = await foldersPOST(jsonReq("/api/tasks/folders", { name: "" }));
    expect(res.status).toBe(400);
  });

  // --- POST list ---

  it("POST /api/tasks/lists creates a standalone list", async () => {
    const res = await listsPOST(jsonReq("/api/tasks/lists", { name: "购物清单" }));
    const json = await res.json();
    expect(res.status).toBe(201);
    expect(json.list.name).toBe("购物清单");
    expect(json.list.folderId).toBeNull();
  });

  it("POST /api/tasks/lists creates a list inside a folder", async () => {
    const folder = await prisma.taskFolder.create({
      data: { name: "工作", sortOrder: 1 },
    });
    const res = await listsPOST(
      jsonReq("/api/tasks/lists", { name: "OKR", folderId: folder.id })
    );
    const json = await res.json();
    expect(res.status).toBe(201);
    expect(json.list.folderId).toBe(folder.id);
  });

  // --- PATCH folder ---

  it("PATCH folder renames + toggles collapsed", async () => {
    const folder = await prisma.taskFolder.create({
      data: { name: "旧名", sortOrder: 1 },
    });
    const res = await folderPATCH(
      jsonReq(`/api/tasks/folders/${folder.id}`, { name: "新名", collapsed: true }, "PATCH"),
      { params: Promise.resolve({ id: folder.id }) }
    );
    expect(res.status).toBe(200);
    const updated = await prisma.taskFolder.findUnique({ where: { id: folder.id } });
    expect(updated?.name).toBe("新名");
    expect(updated?.collapsed).toBe(true);
  });

  // --- DELETE folder (lists promoted to top-level) ---

  it("DELETE folder promotes child lists to top-level", async () => {
    const folder = await prisma.taskFolder.create({
      data: { name: "工作", sortOrder: 1 },
    });
    const list = await prisma.taskList.create({
      data: { name: "OKR", folderId: folder.id, sortOrder: 1 },
    });
    const res = await folderDELETE(
      new NextRequest(`http://localhost/api/tasks/folders/${folder.id}`, { method: "DELETE" }),
      { params: Promise.resolve({ id: folder.id }) }
    );
    expect(res.status).toBe(200);

    // Folder deleted
    const folderExists = await prisma.taskFolder.findUnique({ where: { id: folder.id } });
    expect(folderExists).toBeNull();

    // List promoted to top-level
    const listAfter = await prisma.taskList.findUnique({ where: { id: list.id } });
    expect(listAfter?.folderId).toBeNull();
  });

  // --- DELETE list (tasks soft-deleted) ---

  it("DELETE list soft-deletes tasks and reassigns to default list", async () => {
    const list = await prisma.taskList.create({
      data: { name: "临时清单", sortOrder: 5 },
    });
    const task = await prisma.task.create({
      data: { title: "任务1", listId: list.id },
    });
    const res = await listDELETE(
      new NextRequest(`http://localhost/api/tasks/lists/${list.id}`, { method: "DELETE" }),
      { params: Promise.resolve({ id: list.id }) }
    );
    expect(res.status).toBe(200);

    // List deleted
    const listExists = await prisma.taskList.findUnique({ where: { id: list.id } });
    expect(listExists).toBeNull();

    // Task soft-deleted + reassigned to default list
    const taskAfter = await prisma.task.findUnique({ where: { id: task.id } });
    expect(taskAfter?.trashed).toBe(true);
    expect(taskAfter?.trashedAt).toBeTruthy();
    expect(taskAfter?.expiresAt).toBeTruthy();
    expect(taskAfter?.listId).toBe(DEFAULT_LIST_ID);
  });

  // --- PATCH list ---

  it("PATCH list updates name and color", async () => {
    const list = await prisma.taskList.create({
      data: { name: "原名", color: "#6b7280", sortOrder: 3 },
    });
    const res = await listPATCH(
      jsonReq(`/api/tasks/lists/${list.id}`, { name: "新名", color: "#ef4444" }, "PATCH"),
      { params: Promise.resolve({ id: list.id }) }
    );
    expect(res.status).toBe(200);
    const updated = await prisma.taskList.findUnique({ where: { id: list.id } });
    expect(updated?.name).toBe("新名");
    expect(updated?.color).toBe("#ef4444");
  });

  // --- Reorder folders ---

  it("POST folders/reorder batch-updates sortOrder", async () => {
    const a = await prisma.taskFolder.create({ data: { name: "A", sortOrder: 1 } });
    const b = await prisma.taskFolder.create({ data: { name: "B", sortOrder: 2 } });
    const res = await foldersReorderPOST(
      jsonReq("/api/tasks/folders/reorder", {
        items: [
          { id: b.id, sortOrder: 1 },
          { id: a.id, sortOrder: 2 },
        ],
      })
    );
    expect(res.status).toBe(200);
    const aa = await prisma.taskFolder.findUnique({ where: { id: a.id } });
    const bb = await prisma.taskFolder.findUnique({ where: { id: b.id } });
    expect(aa?.sortOrder).toBe(2);
    expect(bb?.sortOrder).toBe(1);
  });

  // --- Reorder lists (cross-folder move) ---

  it("POST lists/reorder moves list across folders", async () => {
    const f1 = await prisma.taskFolder.create({ data: { name: "F1", sortOrder: 1 } });
    const f2 = await prisma.taskFolder.create({ data: { name: "F2", sortOrder: 2 } });
    const list = await prisma.taskList.create({
      data: { name: "L1", folderId: f1.id, sortOrder: 1 },
    });
    const res = await listsReorderPOST(
      jsonReq("/api/tasks/lists/reorder", {
        items: [{ id: list.id, sortOrder: 0, folderId: f2.id }],
      })
    );
    expect(res.status).toBe(200);
    const after = await prisma.taskList.findUnique({ where: { id: list.id } });
    expect(after?.folderId).toBe(f2.id);
    expect(after?.sortOrder).toBe(0);
  });

  // --- GET full tree after mutations ---

  it("GET /api/tasks/folders returns folders with nested lists + standalone lists", async () => {
    const folder = await prisma.taskFolder.create({
      data: { name: "工作", sortOrder: 1 },
    });
    await prisma.taskList.create({
      data: { name: "OKR", folderId: folder.id, sortOrder: 1 },
    });
    await prisma.taskList.create({
      data: { name: "购物", folderId: null, sortOrder: 2 },
    });

    const res = await foldersGET();
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.folders).toHaveLength(1);
    expect(json.folders[0].name).toBe("工作");
    expect(json.folders[0].lists).toHaveLength(1);
    expect(json.folders[0].lists[0].name).toBe("OKR");
    // default list + "购物" = 2 standalone
    expect(json.standaloneLists).toHaveLength(2);
  });
});
