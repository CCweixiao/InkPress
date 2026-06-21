import { NextResponse } from "next/server";
import { testOssConfig } from "@/lib/oss";

export const runtime = "nodejs";

/** 测试 OSS 配置连通性：上传一个探针文件后立即删除 */
export async function POST() {
  try {
    const uploaded = await testOssConfig();
    return NextResponse.json({
      ok: true,
      message: "OSS 配置测试通过，临时文件已上传并删除。",
      file: uploaded,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "OSS 配置测试失败。" },
      { status: 400 }
    );
  }
}
