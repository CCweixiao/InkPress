import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getAgentConfig } from "@/lib/ai/agent-config";
import { readProjectFile } from "@/lib/ai/project-access";
import { codeSourceProject } from "@/lib/ai/code-source";

type Params = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const document = await prisma.technicalDocument.findUnique({ where: { id } });
  if (!document) {
    return NextResponse.json({ error: "技术文档不存在。" }, { status: 404 });
  }
  const config = await getAgentConfig();
  let project = config.projects.find((item) => item.id === document.projectId);
  if (!project && document.codeSourceJson !== "{}") {
    try {
      const source = JSON.parse(document.codeSourceJson) as { id?: string };
      if (source.id) {
        project = (await codeSourceProject(source.id, config)).project;
      }
    } catch {
      // A temporary grant may have expired; the response below asks for authorization again.
    }
  }
  if (!project) {
    return NextResponse.json(
      { error: "代码源授权已失效，请在写作助手中重新授权。" },
      { status: 403 }
    );
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
