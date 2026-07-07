import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { writeTechnicalDocumentContent } from "@/lib/content-store";
import { withApiLog, logMutation } from "@/lib/api-log";

type Params = { params: Promise<{ id: string; versionId: string }> };

export const POST = withApiLog(
  "POST /api/technical-documents/[id]/versions/[versionId]/rollback",
  async (_req: NextRequest, { params }: Params) => {
    const { id, versionId } = await params;
    const version = await prisma.technicalDocumentVersion.findFirst({
      where: { id: versionId, technicalDocumentId: id },
    });
    if (!version) {
      return NextResponse.json({ error: "版本不存在。" }, { status: 404 });
    }
    // 将版本内容写回文档文件（主文档 markdown 存储于磁盘）
    await writeTechnicalDocumentContent(id, version.markdown);
    // sourceSnapshotJson 形如 { codeSource, ... }，回滚时恢复 codeSourceJson
    const codeSourceJson = (() => {
      try {
        const snapshot = JSON.parse(version.sourceSnapshotJson) as {
          codeSource?: unknown;
        };
        return snapshot.codeSource
          ? JSON.stringify(snapshot.codeSource)
          : undefined;
      } catch {
        return undefined;
      }
    })();
    const document = await prisma.technicalDocument.update({
      where: { id },
      data: {
        title: version.title,
        snapshotHash: version.snapshotHash,
        ...(codeSourceJson !== undefined ? { codeSourceJson } : {}),
      },
    });
    logMutation("techdoc", "rollback", {
      id,
      versionId,
      version: version.version,
    });
    return NextResponse.json({
      document: { ...document, markdown: version.markdown },
    });
  }
);
