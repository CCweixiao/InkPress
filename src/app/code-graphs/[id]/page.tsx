import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { prisma } from "@/lib/db";
import { CodeGraphViewer } from "@/components/code-graphs/CodeGraphViewer";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export default async function CodeGraphPage({ params }: Params) {
  const { id } = await params;
  const graph = await prisma.codeGraphCache.findUnique({ where: { id } });
  if (!graph) notFound();

  let metadata: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(graph.metadataJson);
    if (parsed && typeof parsed === "object") metadata = parsed as Record<string, unknown>;
  } catch {
    metadata = {};
  }

  return (
    <div className="flex h-screen flex-col">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b px-4">
        <Link
          href="/code-graphs"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          代码图谱
        </Link>
        <span className="text-muted-foreground/40">/</span>
        <span className="truncate text-sm font-medium">
          {graph.projectName || graph.root || "代码图谱"}
        </span>
      </header>
      <CodeGraphViewer
        graph={{
          id: graph.id,
          provider: graph.provider,
          status: graph.status,
          projectName: graph.projectName,
          root: graph.root,
          snapshotHash: graph.snapshotHash,
          nodeCount: graph.nodeCount,
          edgeCount: graph.edgeCount,
          lastError: graph.lastError,
          hasReport: Boolean(graph.reportPath),
          hasHtml: Boolean(graph.htmlPath),
          hasGraph: Boolean(graph.graphPath),
          updatedAt: graph.updatedAt.toISOString(),
          metadata,
        }}
      />
    </div>
  );
}
