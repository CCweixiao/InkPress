import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { addAllowedDomain, listAllowedDomains } from "@/lib/ai/web-allowlist";
import { withApiLog } from "@/lib/api-log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/ai/web-allowlist?q=&page=&pageSize= 分页 + 模糊搜索白名单域名。 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q")?.trim() || undefined;
  const pageRaw = Number(searchParams.get("page") ?? "1");
  const pageSizeRaw = Number(searchParams.get("pageSize") ?? "20");
  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? Math.floor(pageRaw) : 1;
  const pageSize =
    Number.isFinite(pageSizeRaw) && pageSizeRaw > 0 ? Math.floor(pageSizeRaw) : 20;
  const result = await listAllowedDomains({ q, page, pageSize });
  return NextResponse.json(result);
}

const postSchema = z.object({
  domain: z.string().min(1).max(200),
  note: z.string().max(200).optional(),
});

/** POST /api/ai/web-allowlist { domain, note? } 添加（归一化 + upsert）。 */
export const POST = withApiLog("POST /api/ai/web-allowlist", async (req: NextRequest) => {
  const parsed = postSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "域名参数无效。" }, { status: 400 });
  }
  try {
    const item = await addAllowedDomain(parsed.data.domain, parsed.data.note);
    return NextResponse.json({ ok: true, item });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "添加失败。" },
      { status: 400 }
    );
  }
});
