import { NextResponse } from "next/server";
import { getPublicLlmProviders } from "@/lib/ai/llm-config";

export const dynamic = "force-dynamic";

/**
 * 返回聊天下拉/选择器用的供应商列表：
 * - 仅暴露 enabled 的模型；某供应商 0 个启用模型则整体隐藏。
 * - 顺序沿用 DB 数组顺序（即设置页树的拖拽顺序）。
 */
export async function GET() {
  const providers = (await getPublicLlmProviders())
    .map((provider) => ({
      ...provider,
      models: provider.models.filter((model) => model.enabled),
    }))
    .filter((provider) => provider.models.length > 0);
  return NextResponse.json({ providers });
}
