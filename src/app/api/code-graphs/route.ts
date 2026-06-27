import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getAgentConfig } from "@/lib/ai/agent-config";
import { getProjectSnapshotHash } from "@/lib/ai/project-index";
import { ensureCodeGraphCache } from "@/lib/ai/code-graph-provider";
import { sourceKey } from "@/lib/ai/graphify-cache";
import { withApiLog, logMutation } from "@/lib/api-log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const graphs = await prisma.codeGraphCache.findMany({
    where: { sourceKey: { not: "" } },
    orderBy: { updatedAt: "desc" },
  });
  return NextResponse.json({ graphs });
}

const buildSchema = z.object({
  projectId: z.string().min(1),
  provider: z.enum(["native", "graphify"]).optional(),
  refresh: z.boolean().optional(),
});

export const POST = withApiLog("POST /api/code-graphs", async (req: NextRequest) => {
  const parsed = buildSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "代码图谱参数无效。" }, { status: 400 });
  }
  const config = await getAgentConfig();
  const project = config.projects.find((item) => item.id === parsed.data.projectId);
  if (!project) {
    return NextResponse.json({ error: "项目不在长期信任列表中。" }, { status: 400 });
  }

  const snapshotHash = await getProjectSnapshotHash(project).catch(() => "");
  if (!snapshotHash) {
    return NextResponse.json(
      { error: "无法计算项目快照哈希，请检查项目路径。" },
      { status: 400 }
    );
  }

  const provider = parsed.data.provider ?? "native";
  const index = await ensureCodeGraphCache({
    project,
    snapshotHash,
    options: { refresh: parsed.data.refresh, provider },
  });

  const record = await prisma.codeGraphCache.findFirst({
    where: {
      provider,
      sourceKey: sourceKey(project),
      snapshotHash,
      spaceId: null,
      articleId: null,
    },
    orderBy: { updatedAt: "desc" },
  });

  if (!index || !record) {
    return NextResponse.json(
      {
        error: "代码图谱构建失败。",
        graph: record,
      },
      { status: 503 }
    );
  }

  logMutation("code-graph", "build", {
    id: record.id,
    provider,
    projectId: project.id,
    nodes: record.nodeCount,
    edges: record.edgeCount,
  });
  return NextResponse.json({ graph: record }, { status: 201 });
});
