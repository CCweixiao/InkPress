import { NextResponse } from "next/server";
import { getPublicLlmProviders } from "@/lib/ai/llm-config";

export const dynamic = "force-dynamic";

/** 返回已启用的 AI 供应商 + 模型列表（脱敏，不含 apiKey/baseUrl） */
export async function GET() {
  const providers = (await getPublicLlmProviders()).filter(
    (provider) => provider.enabled
  );
  return NextResponse.json({ providers });
}
