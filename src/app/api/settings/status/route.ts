import { NextResponse } from "next/server";

/** 只读返回密钥配置状态（不泄露实际值） */
export async function GET() {
  return NextResponse.json({
    hasWxAppid: Boolean(process.env.WX_APPID),
    hasWxSecret: Boolean(process.env.WX_SECRET),
    hasAnthropicKey: Boolean(process.env.ANTHROPIC_API_KEY),
    hasOpenaiKey: Boolean(process.env.OPENAI_API_KEY),
    aiModel: process.env.AI_MODEL ?? "anthropic:claude-3-5-sonnet-latest",
  });
}
