import fs from "node:fs/promises";
import { NextRequest, NextResponse } from "next/server";
import { resolveLocalStorageObject } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const resolved = await resolveLocalStorageObject(id);
  if (!resolved) {
    return NextResponse.json({ error: "存储对象不存在。" }, { status: 404 });
  }

  const body = await fs.readFile(resolved.absolute).catch(() => null);
  if (!body) {
    return NextResponse.json({ error: "存储文件不存在。" }, { status: 404 });
  }

  return new NextResponse(body, {
    headers: {
      "Content-Type": resolved.object.contentType || "application/octet-stream",
      "Content-Length": String(body.byteLength),
      "Cache-Control": "private, max-age=3600",
    },
  });
}
