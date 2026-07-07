import { NextResponse } from "next/server";
import { z } from "zod";
import { getAgentConfig } from "@/lib/ai/agent-config";
import { codeSourceProject } from "@/lib/ai/code-source";
import { readGitLog, resolveGitRange } from "@/lib/ai/git-analysis";

export const runtime = "nodejs";
export const maxDuration = 120;

const schema = z.object({
  base: z.string().optional(),
  head: z.string().optional(),
  since: z.string().optional(),
  until: z.string().optional(),
  requestedRange: z.string().optional(),
  maxCommits: z.coerce.number().int().min(1).max(100).optional(),
});

export async function GET(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const url = new URL(req.url);
  const parsed = schema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) {
    return NextResponse.json({ error: "Git 范围参数无效。" }, { status: 400 });
  }
  try {
    const config = await getAgentConfig();
    const { project, source } = await codeSourceProject(id, config, {
      historyDepth: 200,
    });
    const range = await resolveGitRange(project, parsed.data);
    const log = await readGitLog(project, {
      ...range,
      maxCommits: parsed.data.maxCommits,
    });
    return NextResponse.json({ source, range, ...log });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "读取提交失败。" },
      { status: 400 }
    );
  }
}
