import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { readTechnicalDocumentContent } from "@/lib/content-store";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Params) {
  const { id } = await params;
  const document = await prisma.technicalDocument.findUnique({ where: { id } });
  if (!document) {
    return NextResponse.json({ error: "技术文档不存在。" }, { status: 404 });
  }
  const markdown = await readTechnicalDocumentContent(id);
  const filename =
    (document.title || "technical-document").replace(/[\\/:*?"<>|]/g, "-") +
    ".md";
  return new NextResponse(markdown, {
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
    },
  });
}
