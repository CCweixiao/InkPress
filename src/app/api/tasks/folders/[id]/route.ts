import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { renameFolder, setFolderCollapsed, deleteFolder, reorderFolders } from "@/lib/tasks/list-repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const patchSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  collapsed: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const body = await req.json().catch(() => ({}));
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { name, collapsed, sortOrder } = parsed.data;
  if (name !== undefined) await renameFolder(id, name);
  if (collapsed !== undefined) await setFolderCollapsed(id, collapsed);
  if (sortOrder !== undefined) {
    await reorderFolders([{ id, sortOrder }]);
  }
  return NextResponse.json({ success: true });
}

export async function DELETE(_req: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  try {
    await deleteFolder(id);
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "删除文件夹失败" }, { status: 500 });
  }
}
