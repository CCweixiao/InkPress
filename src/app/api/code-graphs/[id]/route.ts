import fs from "node:fs/promises";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { storageDir } from "@/lib/paths";
import { withApiLog, logMutation } from "@/lib/api-log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

function parseMetadata(raw: string | null | undefined) {
  if (!raw) return {};
  try {
    const value = JSON.parse(raw);
    return typeof value === "object" && value ? value : {};
  } catch {
    return {};
  }
}

export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const graph = await prisma.codeGraphCache.findUnique({ where: { id } });
  if (!graph) {
    return NextResponse.json({ error: "代码图谱不存在。" }, { status: 404 });
  }
  return NextResponse.json({
    graph: { ...graph, metadata: parseMetadata(graph.metadataJson) },
  });
}

export const DELETE = withApiLog("DELETE /api/code-graphs/[id]", async (
  _req: NextRequest,
  { params }: Params
) => {
  const { id } = await params;
  const graph = await prisma.codeGraphCache.findUnique({ where: { id } });
  if (!graph) {
    return NextResponse.json({ error: "代码图谱不存在。" }, { status: 404 });
  }

  // 清理落盘的三件套（graph.json / report / html）以及整个快照目录。
  // graphPath 形如 code-sources/<key>/snapshots/<hash>/graphify-out/graph.json，
  // 其祖父目录即快照根，整目录删除以释放 code-input 镜像等中间产物。
  const storageRoot = path.resolve(storageDir());
  const removed: string[] = [];
  for (const rel of [graph.graphPath, graph.reportPath, graph.htmlPath]) {
    if (!rel) continue;
    const abs = path.resolve(storageRoot, rel);
    if (!isInsideStorage(abs, storageRoot)) continue;
    await fs.rm(abs, { force: true });
    removed.push(rel);
  }
  // 删除 graphPath 所在的快照目录（graphify-out 的父目录）。
  if (graph.graphPath) {
    const abs = path.resolve(storageRoot, graph.graphPath);
    if (isInsideStorage(abs, storageRoot)) {
      const graphifyOut = path.dirname(abs);
      const snapshotDir = path.dirname(graphifyOut);
      if (isInsideStorage(snapshotDir, storageRoot)) {
        await fs.rm(snapshotDir, { recursive: true, force: true });
      }
    }
  }

  await prisma.codeGraphCache.delete({ where: { id } });
  logMutation("code-graph", "delete", { id, provider: graph.provider, removedFiles: removed.length });
  return NextResponse.json({ ok: true, id });
});

function isInsideStorage(target: string, storageRoot: string) {
  const resolved = path.resolve(target);
  return resolved === storageRoot || resolved.startsWith(`${storageRoot}${path.sep}`);
}
