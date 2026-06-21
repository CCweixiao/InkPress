import { NextResponse } from "next/server";
import { z } from "zod";
import {
  approveCodeSourceGrant,
  rejectCodeSourceGrant,
} from "@/lib/ai/code-source";

export const runtime = "nodejs";

const schema = z.object({
  approvalToken: z.string().min(16),
  action: z.enum(["approve", "reject"]).default("approve"),
  scope: z.enum(["session", "trusted"]).default("session"),
});

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "授权参数无效。" }, { status: 400 });
  }
  try {
    const grant =
      parsed.data.action === "reject"
        ? await rejectCodeSourceGrant({
            id,
            approvalToken: parsed.data.approvalToken,
          })
        : await approveCodeSourceGrant({
            id,
            approvalToken: parsed.data.approvalToken,
            scope: parsed.data.scope,
          });
    return NextResponse.json({ ok: true, source: grant });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "授权失败。" },
      { status: 409 }
    );
  }
}
