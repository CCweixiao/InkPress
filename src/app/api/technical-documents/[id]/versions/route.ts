import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Params) {
  const { id } = await params;
  const versions = await prisma.technicalDocumentVersion.findMany({
    where: { technicalDocumentId: id },
    orderBy: { version: "desc" },
  });
  return NextResponse.json({ versions });
}
