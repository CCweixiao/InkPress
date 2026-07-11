import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { reorderLists } from "@/lib/tasks/list-repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      sortOrder: z.number().int(),
      folderId: z.string().nullable().optional(),
    })
  ),
});

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  await reorderLists(parsed.data.items);
  return NextResponse.json({ success: true });
}
