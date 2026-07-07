import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withApiLog, logMutation } from "@/lib/api-log";

type Params = { params: Promise<{ id: string; versionId: string }> };

export const DELETE = withApiLog(
  "DELETE /api/technical-documents/[id]/versions/[versionId]",
  async (_req: NextRequest, { params }: Params) => {
    const { id, versionId } = await params;
    const version = await prisma.technicalDocumentVersion.findFirst({
      where: { id: versionId, technicalDocumentId: id },
    });
    if (!version) {
      return NextResponse.json({ error: "版本不存在。" }, { status: 404 });
    }
    await prisma.technicalDocumentVersion.delete({ where: { id: versionId } });
    logMutation("techdoc", "delete-version", {
      id,
      versionId,
      version: version.version,
    });
    return NextResponse.json({ ok: true });
  }
);
