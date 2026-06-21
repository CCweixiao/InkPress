import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import {
  deleteTechnicalDocumentContent,
  readTechnicalDocumentContent,
  writeTechnicalDocumentContent,
} from "@/lib/content-store";
import { getAgentConfig } from "@/lib/ai/agent-config";
import { getProjectSnapshotHash } from "@/lib/ai/project-index";
import { codeSourceProject } from "@/lib/ai/code-source";

type Params = { params: Promise<{ id: string }> };
const updateSchema = z.object({
  title: z.string().max(200).optional(),
  markdown: z.string().optional(),
  documentType: z
    .enum([
      "architecture",
      "implementation",
      "call-chain",
      "module-reference",
      "dependency",
    ])
    .optional(),
  snapshotHash: z.string().optional(),
});

export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const document = await prisma.technicalDocument.findUnique({ where: { id } });
  if (!document) {
    return NextResponse.json({ error: "技术文档不存在。" }, { status: 404 });
  }
  const markdown = await readTechnicalDocumentContent(id);
  const config = await getAgentConfig();
  let project = config.projects.find((item) => item.id === document.projectId);
  if (!project && document.codeSourceJson !== "{}") {
    try {
      const source = JSON.parse(document.codeSourceJson) as { id?: string };
      if (source.id) project = (await codeSourceProject(source.id, config)).project;
    } catch {
      // Temporary grants can expire; stale status remains unknown until reauthorization.
    }
  }
  let currentSnapshotHash = "";
  if (project) {
    currentSnapshotHash =
      (await getProjectSnapshotHash(project).catch(() => "")) ?? "";
  }
  return NextResponse.json({
    document: {
      ...document,
      markdown,
      currentSnapshotHash,
      stale:
        Boolean(document.snapshotHash) &&
        Boolean(currentSnapshotHash) &&
        document.snapshotHash !== currentSnapshotHash,
    },
  });
}

export async function PUT(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const parsed = updateSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "更新参数无效。" }, { status: 400 });
  }
  const existing = await prisma.technicalDocument.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "技术文档不存在。" }, { status: 404 });
  }
  if (parsed.data.markdown !== undefined) {
    await writeTechnicalDocumentContent(id, parsed.data.markdown);
  }
  const document = await prisma.technicalDocument.update({
    where: { id },
    data: {
      ...(parsed.data.title !== undefined ? { title: parsed.data.title } : {}),
      ...(parsed.data.documentType !== undefined
        ? { documentType: parsed.data.documentType }
        : {}),
      ...(parsed.data.snapshotHash !== undefined
        ? { snapshotHash: parsed.data.snapshotHash }
        : {}),
    },
  });
  return NextResponse.json({ document });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  await prisma.technicalDocument.delete({ where: { id } }).catch(() => null);
  await deleteTechnicalDocumentContent(id);
  return NextResponse.json({ ok: true });
}
