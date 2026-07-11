import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { listFoldersWithLists, createFolder } from "@/lib/tasks/list-repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const tree = await listFoldersWithLists();
  return NextResponse.json(tree);
}

const createFolderSchema = z.object({ name: z.string().min(1).max(100) });

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const parsed = createFolderSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const folder = await createFolder(parsed.data.name);
  return NextResponse.json({ folder }, { status: 201 });
}
