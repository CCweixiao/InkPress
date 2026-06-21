import { NextResponse } from "next/server";
import { getAgentConfig } from "@/lib/ai/agent-config";

export const runtime = "nodejs";

export async function GET() {
  const config = await getAgentConfig();
  return NextResponse.json({
    projects: config.projects.map(({ id, name }) => ({ id, name })),
    searchConfigured: Boolean(config.tavilyApiKey),
  });
}
