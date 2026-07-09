import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import type { ComposerDocument } from "@/lib/snippets/injection-review";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const actionSchema = z.object({
  action: z.enum(["apply", "reject"]),
});

function parseComposer(value: string): ComposerDocument {
  try {
    return JSON.parse(value) as ComposerDocument;
  } catch {
    return [];
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const parsed = actionSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "审核操作无效" }, { status: 400 });
  }
  const existing = await prisma.snippetInjectionReview.findUnique({
    where: { id },
  });
  if (!existing) {
    return NextResponse.json({ error: "审核记录不存在" }, { status: 404 });
  }
  if (
    existing.status !== "pending" &&
    !(existing.status === "error" && parsed.data.action === "reject")
  ) {
    return NextResponse.json(
      { error: "该审核已经处理", status: existing.status },
      { status: 409 }
    );
  }
  const now = new Date();
  const status = parsed.data.action === "apply" ? "applied" : "rejected";
  const review = await prisma.snippetInjectionReview.update({
    where: { id },
    data:
      status === "applied"
        ? { status, appliedAt: now }
        : { status, rejectedAt: now },
  });
  return NextResponse.json({
    review: {
      id: review.id,
      status: review.status,
      composer: parseComposer(review.composerJson),
      visibleText: review.visibleText,
      runtimeText: review.runtimeText,
    },
  });
}
