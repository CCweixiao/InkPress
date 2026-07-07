import Link from "next/link";
import { ArrowLeft, Network } from "lucide-react";
import { prisma } from "@/lib/db";
import { CodeGraphList } from "@/components/code-graphs/CodeGraphList";

export const dynamic = "force-dynamic";

export default async function CodeGraphsPage() {
  const graphs = await prisma.codeGraphCache.findMany({
    where: { sourceKey: { not: "" } },
    orderBy: { updatedAt: "desc" },
  });
  return (
    <div className="min-h-screen bg-muted/20">
      <header className="border-b bg-background">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-6">
          <Link href="/" className="text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <Network className="h-5 w-5 text-primary" />
          <div>
            <div className="font-semibold">代码图谱</div>
            <div className="text-[11px] text-muted-foreground">
              原生构建代码知识图谱 · 符号 / 调用 / 依赖 · Markdown 报告与可视化
            </div>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8">
        <CodeGraphList
          initialGraphs={graphs.map((graph) => ({
            id: graph.id,
            provider: graph.provider,
            status: graph.status,
            projectName: graph.projectName,
            root: graph.root,
            snapshotHash: graph.snapshotHash,
            nodeCount: graph.nodeCount,
            edgeCount: graph.edgeCount,
            updatedAt: graph.updatedAt.toISOString(),
          }))}
        />
      </main>
    </div>
  );
}
