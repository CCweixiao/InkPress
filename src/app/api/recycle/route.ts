import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 列出回收站内的 文章 / 空间 / 素材（trashed=true 且未过期） */
export async function GET() {
  const [articles, spaces, assets] = await Promise.all([
    prisma.article.findMany({
      where: { trashed: true },
      orderBy: { trashedAt: "desc" },
      select: {
        id: true,
        title: true,
        spaceId: true,
        status: true,
        trashedAt: true,
        expiresAt: true,
      },
    }),
    prisma.space.findMany({
      where: { trashed: true },
      orderBy: { trashedAt: "desc" },
      select: {
        id: true,
        name: true,
        trashedAt: true,
        expiresAt: true,
      },
    }),
    prisma.asset.findMany({
      where: { trashed: true },
      orderBy: { trashedAt: "desc" },
      select: {
        id: true,
        name: true,
        kind: true,
        url: true,
        trashedAt: true,
        expiresAt: true,
      },
    }),
  ]);

  return NextResponse.json({ articles, spaces, assets });
}
