import { NextResponse } from "next/server";
import { listSkills } from "@/lib/ai/skills";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ skills: await listSkills() });
}
