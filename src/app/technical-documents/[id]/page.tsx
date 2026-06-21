import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { prisma } from "@/lib/db";
import { readTechnicalDocumentContent } from "@/lib/content-store";
import { getAgentConfig } from "@/lib/ai/agent-config";
import { getProjectSnapshotHash } from "@/lib/ai/project-index";
import { TechnicalDocumentWorkspace } from "@/components/technical-documents/TechnicalDocumentWorkspace";

export const dynamic = "force-dynamic";
type Params = { params: Promise<{ id: string }> };

export default async function TechnicalDocumentPage({ params }: Params) {
  const { id } = await params;
  const document = await prisma.technicalDocument.findUnique({ where: { id } });
  if (!document) notFound();
  const markdown = await readTechnicalDocumentContent(id);
  const config = await getAgentConfig();
  const project = config.projects.find((item) => item.id === document.projectId);
  const currentSnapshotHash = project
    ? await getProjectSnapshotHash(project).catch(() => "")
    : "";
  return (
    <div className="flex h-screen flex-col">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b px-4">
        <Link
          href="/technical-documents"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          技术文档
        </Link>
        <span className="text-muted-foreground/40">/</span>
        <span className="truncate text-sm font-medium">
          {document.title || "未命名技术文档"}
        </span>
      </header>
      <TechnicalDocumentWorkspace
        initialDocument={{
          id: document.id,
          title: document.title,
          documentType: document.documentType,
          projectId: document.projectId,
          markdown,
          snapshotHash: document.snapshotHash,
          currentSnapshotHash,
          stale:
            Boolean(document.snapshotHash) &&
            Boolean(currentSnapshotHash) &&
            document.snapshotHash !== currentSnapshotHash,
        }}
      />
    </div>
  );
}
