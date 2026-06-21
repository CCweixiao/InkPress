import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getAgentConfig } from "@/lib/ai/agent-config";
import {
  technicalDocumentRelativePath,
  writeTechnicalDocumentContent,
} from "@/lib/content-store";

const createSchema = z.object({
  title: z.string().trim().max(200).default("未命名技术文档"),
  documentType: z
    .enum([
      "architecture",
      "implementation",
      "call-chain",
      "module-reference",
      "dependency",
    ])
    .default("architecture"),
  projectId: z.string().min(1),
});

export async function GET() {
  const documents = await prisma.technicalDocument.findMany({
    orderBy: { updatedAt: "desc" },
  });
  return NextResponse.json({ documents });
}

export async function POST(req: NextRequest) {
  const parsed = createSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "技术文档参数无效。" }, { status: 400 });
  }
  const config = await getAgentConfig();
  if (!config.projects.some((project) => project.id === parsed.data.projectId)) {
    return NextResponse.json({ error: "项目不在长期信任列表中。" }, { status: 400 });
  }
  const document = await prisma.technicalDocument.create({
    data: parsed.data,
  });
  await writeTechnicalDocumentContent(document.id, "");
  const updated = await prisma.technicalDocument.update({
    where: { id: document.id },
    data: { contentPath: technicalDocumentRelativePath(document.id) },
  });
  return NextResponse.json({ document: updated }, { status: 201 });
}
