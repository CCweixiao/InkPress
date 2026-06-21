import { parseJsonObjectOrArrayConfig } from "@/lib/system-config";

export const OSS_CONFIG_KEY = "inkpress.oss";

const ossConfigFields = [
  "bucket",
  "domain",
  "accessKeyId",
  "accessKeySecret",
] as const;

export type OssConfig = Record<(typeof ossConfigFields)[number], string>;

export function parseOssConfig(value: string): OssConfig {
  const raw = parseJsonObjectOrArrayConfig(value, "OSS 配置");
  if (Array.isArray(raw)) throw new Error("OSS 配置必须是 JSON 对象。");
  const config = raw as Record<string, unknown>;
  const missing = ossConfigFields.filter(
    (field) => typeof config[field] !== "string" || !config[field].trim()
  );
  if (missing.length)
    throw new Error(`OSS 配置缺少字段：${missing.join(", ")}。`);

  return {
    bucket: String(config.bucket).trim(),
    domain: String(config.domain).trim().replace(/\/+$/, ""),
    accessKeyId: String(config.accessKeyId).trim(),
    accessKeySecret: String(config.accessKeySecret).trim(),
  };
}
