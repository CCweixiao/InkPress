import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withApiLog, logMutation } from "@/lib/api-log";
import {
  validateBatchBody,
  dedupeIds,
  parseTags,
  mergeTag,
  removeTag,
} from "@/lib/snippets/batch-ops";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 选择模式批量操作：delete（软删）/ pin / addTag / removeTag。
 * - delete / pin：updateMany 一次成型。
 * - addTag / removeTag：SQLite 无原生 JSON update → $transaction 逐条 read-modify-write。
 */
export const POST = withApiLog(
  "POST /api/snippets/batch",
  async (req: NextRequest) => {
    const parsed = validateBatchBody(await req.json().catch(() => ({})));
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }
    // 用 body（而非解构 action）做判别，TS 才能 narrow union 访问 pinned/tag
    const body = parsed.data;
    const ids = dedupeIds(body.ids);

    // 只操作实存且未删除的
    const found = await prisma.snippet.findMany({
      where: { id: { in: ids }, trashed: false },
    });
    if (found.length === 0) {
      return NextResponse.json({ error: "没有可操作的素材" }, { status: 400 });
    }
    const foundIds = found.map((s) => s.id);

    try {
      if (body.action === "delete") {
        const now = new Date();
        await prisma.snippet.updateMany({
          where: { id: { in: foundIds } },
          data: { trashed: true, trashedAt: now },
        });
      } else if (body.action === "pin") {
        await prisma.snippet.updateMany({
          where: { id: { in: foundIds } },
          data: { pinned: body.pinned },
        });
      } else {
        // addTag / removeTag：逐条 read-modify-write，事务保原子
        const tag = body.tag;
        await prisma.$transaction(async (tx) => {
          for (const row of found) {
            const before = parseTags(row.tagsJson);
            const after =
              body.action === "addTag" ? mergeTag(before, tag) : removeTag(before, tag);
            await tx.snippet.update({
              where: { id: row.id },
              data: { tagsJson: JSON.stringify(after) },
            });
          }
        });
      }
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : "批量操作失败" },
        { status: 500 }
      );
    }

    logMutation("snippet", body.action, {
      count: found.length,
      tag: body.action === "addTag" || body.action === "removeTag" ? body.tag : undefined,
    });

    return NextResponse.json({ ok: true, affected: found.length });
  }
);
