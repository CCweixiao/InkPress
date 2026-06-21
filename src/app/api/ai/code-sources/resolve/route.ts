import { NextResponse } from "next/server";
import { z } from "zod";
import { getAgentConfig } from "@/lib/ai/agent-config";
import { getOrCreateAgentSession } from "@/lib/ai/chat-persistence";
import {
  createOrReuseCodeSourceGrant,
  extractCodeSourceCandidate,
} from "@/lib/ai/code-source";

export const runtime = "nodejs";

const schema = z.object({
  target: z.object({
    kind: z.enum(["article", "technical-document"]),
    id: z.string().min(1),
  }),
  message: z.string().min(1),
});

export async function POST(req: Request) {
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "代码源解析参数无效。" }, { status: 400 });
  }
  const config = await getAgentConfig();
  const candidate = extractCodeSourceCandidate(
    parsed.data.message,
    config.projects
  );
  if (!candidate) {
    return NextResponse.json({ candidate: null, error: "没有识别到代码源。" });
  }
  try {
    const session = await getOrCreateAgentSession(parsed.data.target);
    const { grant, approvalToken } = await createOrReuseCodeSourceGrant({
      sessionId: session.id,
      candidate,
    });
    return NextResponse.json({
      source: {
        id: grant.id,
        kind: grant.kind,
        displayName: grant.displayName,
        locator: grant.locator,
        status: grant.status,
        scope: grant.scope,
      },
      approvalToken,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "代码源解析失败。" },
      { status: 400 }
    );
  }
}
