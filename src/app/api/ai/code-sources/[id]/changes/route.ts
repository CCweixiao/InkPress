import { NextResponse } from "next/server";
import { z } from "zod";
import { getAgentConfig } from "@/lib/ai/agent-config";
import { codeSourceProject } from "@/lib/ai/code-source";
import {
  readGitDiff,
  readGitDiffSummary,
  resolveGitRange,
} from "@/lib/ai/git-analysis";

export const runtime = "nodejs";
export const maxDuration = 120;

const schema = z.object({
  base: z.string().optional(),
  head: z.string().optional(),
  since: z.string().optional(),
  until: z.string().optional(),
  requestedRange: z.string().optional(),
  file: z.string().optional(),
  includeDiff: z.boolean().default(false),
});

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "变更分析参数无效。" }, { status: 400 });
  }
  try {
    const config = await getAgentConfig();
    const { project, source } = await codeSourceProject(id, config, {
      historyDepth: 200,
    });
    const range = await resolveGitRange(project, parsed.data);
    const summary = await readGitDiffSummary(project, range);
    const diff = parsed.data.includeDiff
      ? await readGitDiff(project, {
          ...range,
          file: parsed.data.file,
        })
      : undefined;
    return NextResponse.json({ source, range, ...summary, ...(diff ? { diff } : {}) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "分析变更失败。" },
      { status: 400 }
    );
  }
}
