import { NextRequest, NextResponse } from "next/server";
import { createSkillFromZip } from "@/lib/skills-manager";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10MB

/**
 * 上传 skill 资源压缩包。
 * - multipart：字段名 file，单个 .zip
 * - 服务端解压校验 → 写入 resources/skills/<key>/ → 落 DB（含 manifest 资源清单）
 * - 校验失败返回 400 + 具体原因
 */
export async function POST(req: NextRequest) {
  const form = await req.formData().catch(() => null);
  if (!form) {
    return NextResponse.json({ error: "请上传 multipart 表单数据" }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "缺少 file 字段" }, { status: 400 });
  }
  const lowerName = file.name.toLowerCase();
  if (!lowerName.endsWith(".zip")) {
    return NextResponse.json({ error: "仅支持 .zip 压缩包" }, { status: 400 });
  }
  if (file.size === 0) {
    return NextResponse.json({ error: "文件为空" }, { status: 400 });
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json(
      { error: `压缩包过大（>${MAX_UPLOAD_BYTES / 1024 / 1024}MB）` },
      { status: 400 }
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  try {
    const skill = await createSkillFromZip(buffer);
    return NextResponse.json({ skill }, { status: 201 });
  } catch (e) {
    // 校验 / 解析错误：用户可修复，返回 400 + 明确原因
    const message = e instanceof Error ? e.message : "压缩包解析失败";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
