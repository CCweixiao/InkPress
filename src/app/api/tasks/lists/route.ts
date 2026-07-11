import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createList } from "@/lib/tasks/list-repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  name: z.string().min(1).max(100),
  color: z.string().optional(),
  folderId: z.string().nullable().optional(),
});

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const list = await createList({
    name: parsed.data.name,
    color: parsed.data.color,
    folderId: parsed.data.folderId,
  });
  return NextResponse.json({ list }, { status: 201 });
}
