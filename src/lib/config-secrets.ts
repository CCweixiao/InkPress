import { decryptSecret, encryptSecret } from "@/lib/crypto/secret-store";

type JsonRecord = Record<string, unknown>;

const CONFIG_SECRET_FIELDS: Record<string, string[][]> = {
  "inkpress.llm": [["*", "apiKey"]],
  "inkpress.oss": [["accessKeySecret"]],
  "inkpress.storage": [
    ["providers", "aliyunOss", "accessKeySecret"],
    ["providers", "aliyun-oss", "accessKeySecret"],
    ["providers", "oss", "accessKeySecret"],
    ["aliyunOss", "accessKeySecret"],
    ["aliyun-oss", "accessKeySecret"],
    ["oss", "accessKeySecret"],
  ],
  "inkpress.agent": [["tavilyApiKey"], ["githubToken"]],
  "inkpress.web-research": [["tavilyApiKey"]],
  "inkpress.wechat": [["secret"]],
};

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function transformAtPath(
  value: unknown,
  path: string[],
  transform: (secret: string) => string
): void {
  if (!path.length) return;
  if (path[0] === "*") {
    const rest = path.slice(1);
    const items = Array.isArray(value) ? value : [value];
    for (const item of items) transformAtPath(item, rest, transform);
    return;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const record = value as JsonRecord;
  const key = path[0];
  if (path.length === 1) {
    if (typeof record[key] === "string" && record[key]) {
      record[key] = transform(record[key]);
    }
    return;
  }
  transformAtPath(record[key], path.slice(1), transform);
}

function transformConfigValue(
  key: string,
  value: string,
  transform: (secret: string) => string
): string {
  const fields = CONFIG_SECRET_FIELDS[key];
  if (!fields?.length) return value;
  const parsed = JSON.parse(value) as unknown;
  const next = cloneJson(parsed);
  for (const field of fields) transformAtPath(next, field, transform);
  return JSON.stringify(next, null, 2);
}

export function hasConfigSecrets(key: string): boolean {
  return !!CONFIG_SECRET_FIELDS[key]?.length;
}

export function encryptConfigValueForStorage(key: string, value: string): string {
  return transformConfigValue(key, value, encryptSecret);
}

export function decryptConfigValueForUse(
  key: string,
  value?: string | null
): string | undefined {
  if (!value) return undefined;
  return transformConfigValue(key, value, decryptSecret);
}

export function decryptConfigValueForExport(key: string, value: string): string {
  return transformConfigValue(key, value, decryptSecret);
}
