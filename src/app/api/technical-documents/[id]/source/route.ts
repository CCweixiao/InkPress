import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getAgentConfig } from "@/lib/ai/agent-config";
import { readProjectFile } from "@/lib/ai/project-access";

type Params = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const document = await prisma.technicalDocument.findUnique({ where: { id } });
  if (!document) {
    return NextResponse.json({ error: "技术文档不存在。" }, { status: 404 });
  }
  const config = await getAgentConfig();
  const project = config.projects.find((item) => item.id === document.projectId);
  if (!project) {
    return NextResponse.json({ error: "项目不在只读白名单中。" }, { status: 403 });
  }
  const pathname = req.nextUrl.searchParams.get("path") ?? "";
  const startLine = Number(req.nextUrl.searchParams.get("startLine") ?? 1);
  const endLine = Number(req.nextUrl.searchParams.get("endLine") ?? startLine + 80);
  try {
    const source = await readProjectFile(project, {
      path: pathname,
      startLine,
      endLine,
    });
    return NextResponse.json({ source });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "源码读取失败。" },
      { status: 400 }
    );
  }
}
