import { NextResponse } from "next/server";
import { embedText } from "@/lib/snippets/embedding";
import { getEmbeddingConfig } from "@/lib/ai/embedding-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 用已存的 inkpress.embedding 配置打一次 sample embedding，验证连通 + 返回维度。 */
export async function POST() {
  const cfg = await getEmbeddingConfig();
  if (!cfg) {
    return NextResponse.json(
      { ok: false, error: "未配置 embedding 供应商" },
      { status: 400 }
    );
  }
  const vec = await embedText("测试连通性", cfg);
  if (!vec) {
    return NextResponse.json(
      { ok: false, error: "调用失败，请检查 baseUrl/apiKey/model" },
      { status: 502 }
    );
  }
  return NextResponse.json({ ok: true, dimensions: vec.length, model: cfg.model });
}
