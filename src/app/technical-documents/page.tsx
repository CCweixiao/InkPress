import Link from "next/link";
import { ArrowLeft, FileCode2 } from "lucide-react";
import { prisma } from "@/lib/db";
import { TechnicalDocumentList } from "@/components/technical-documents/TechnicalDocumentList";

export const dynamic = "force-dynamic";

export default async function TechnicalDocumentsPage() {
  const documents = await prisma.technicalDocument.findMany({
    orderBy: { updatedAt: "desc" },
  });
  return (
    <div className="min-h-screen bg-muted/20">
      <header className="border-b bg-background">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-6">
          <Link href="/" className="text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <FileCode2 className="h-5 w-5 text-primary" />
          <div>
            <div className="font-semibold">技术文档</div>
            <div className="text-[11px] text-muted-foreground">
              基于只读代码证据生成架构、实现和调用链文档
            </div>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8">
        <TechnicalDocumentList
          initialDocuments={documents.map((document) => ({
            ...document,
            updatedAt: document.updatedAt.toISOString(),
          }))}
        />
      </main>
    </div>
  );
}
