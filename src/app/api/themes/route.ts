import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";

const upsertSchema = z.object({
  name: z.string().min(1).max(50),
  cssContent: z.string(),
  codeTheme: z.string().default("atom-one-dark"),
  primaryColor: z.string().default("#3f51b5"),
});

// 列出全部主题
export async function GET() {
  const themes = await prisma.theme.findMany({
    orderBy: [{ isBuiltIn: "desc" }, { createdAt: "asc" }],
  });
  return NextResponse.json({ themes });
}

// 新建自定义主题
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const parsed = upsertSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const theme = await prisma.theme.create({
    data: { ...parsed.data, isBuiltIn: false },
  });
  return NextResponse.json({ theme }, { status: 201 });
}
