import { NextResponse } from "next/server";
import { z } from "zod";
import { LLM_CONFIG_KEY, parseLlmConfigs } from "@/lib/ai/llm-config";
import { OSS_CONFIG_KEY, parseOssConfig } from "@/lib/oss-config";
import {
  STORAGE_CONFIG_KEY,
  localStorageDisplayPath,
  maskStorageConfigValue,
  mergeStorageMaskedSecrets,
  parseStorageConfig,
} from "@/lib/storage-config";
import { AGENT_CONFIG_KEY, parseAgentConfig } from "@/lib/ai/agent-config";
import { WECHAT_CONFIG_KEY, parseWechatConfig } from "@/lib/wechat/config";
import { APPEARANCE_CONFIG_KEY, parseAppearanceConfig } from "@/lib/appearance-config";
import { UI_PREFERENCES_KEY, parseUiPreferences } from "@/lib/ui-preferences";
import { I18N_CONFIG_KEY, parseI18nConfig } from "@/lib/i18n-config";
import { parseJsonObjectOrArrayConfig } from "@/lib/system-config";
import { prisma } from "@/lib/db";
import { withApiLog, logMutation } from "@/lib/api-log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const configSchema = z.object({
  key: z.string().trim().min(1, "请输入配置 key。").max(120),
  value: z.string().trim().min(2, "请输入配置 value。"),
});

const deleteSchema = z.object({ key: z.string().trim().min(1) });

/** 保存前按 key 分别校验 value 的 JSON 结构 */
function validateConfigValue(key: string, value: string) {
  if (key === STORAGE_CONFIG_KEY) parseStorageConfig(value);
  else if (key === OSS_CONFIG_KEY) parseOssConfig(value);
  else if (key === LLM_CONFIG_KEY) parseLlmConfigs(value);
  else if (key === AGENT_CONFIG_KEY) parseAgentConfig(value);
  else if (key === WECHAT_CONFIG_KEY) parseWechatConfig(value);
  else if (key === APPEARANCE_CONFIG_KEY) parseAppearanceConfig(value);
  else if (key === UI_PREFERENCES_KEY) parseUiPreferences(value);
  else if (key === I18N_CONFIG_KEY) parseI18nConfig(value);
  else parseJsonObjectOrArrayConfig(value);
}

/** 返回脱敏的配置列表（API Key 仅返回是否已填，不回传明文） */
function maskConfigs(
  configs: { id: string; key: string; value: string; createdAt: Date; updatedAt: Date }[]
) {
  return configs.map((item) => {
    if (item.key === LLM_CONFIG_KEY) {
      try {
        const parsed = JSON.parse(item.value) as unknown;
        const list = (Array.isArray(parsed) ? parsed : [parsed]) as Array<
          Record<string, unknown>
        >;
        const masked = list.map((c) => ({
          ...c,
          apiKey: typeof c.apiKey === "string" && c.apiKey ? "********" : "",
        }));
        return { ...item, value: JSON.stringify(masked, null, 2) };
      } catch {
        return item;
      }
    }
    if (item.key === STORAGE_CONFIG_KEY) {
      return { ...item, value: maskStorageConfigValue(item.value) };
    }
    if (item.key === OSS_CONFIG_KEY) {
      try {
        const parsed = JSON.parse(item.value) as Record<string, unknown>;
        return {
          ...item,
          value: JSON.stringify(
            {
              ...parsed,
              accessKeySecret:
                typeof parsed.accessKeySecret === "string" &&
                parsed.accessKeySecret
                  ? "********"
                  : "",
            },
            null,
            2
          ),
        };
      } catch {
        return item;
      }
    }
    if (item.key === AGENT_CONFIG_KEY) {
      try {
        const parsed = JSON.parse(item.value) as Record<string, unknown>;
        return {
          ...item,
          value: JSON.stringify(
            {
              ...parsed,
              tavilyApiKey:
                typeof parsed.tavilyApiKey === "string" && parsed.tavilyApiKey
                  ? "********"
                  : "",
              githubToken:
                typeof parsed.githubToken === "string" && parsed.githubToken
                  ? "********"
                  : "",
            },
            null,
            2
          ),
        };
      } catch {
        return item;
      }
    }
    if (item.key === WECHAT_CONFIG_KEY) {
      try {
        const parsed = JSON.parse(item.value) as Record<string, unknown>;
        return {
          ...item,
          value: JSON.stringify(
            {
              ...parsed,
              secret:
                typeof parsed.secret === "string" && parsed.secret
                  ? "********"
                  : "",
            },
            null,
            2
          ),
        };
      } catch {
        return item;
      }
    }
    return item;
  });
}

export async function GET() {
  const configs = await prisma.systemConfig.findMany({
    orderBy: { key: "asc" },
  });
  return NextResponse.json({
    ok: true,
    configs: maskConfigs(configs),
    storageInfo: { localPath: localStorageDisplayPath() },
  });
}

export const POST = withApiLog("POST /api/system-config", async (req: Request) => {
  const parsed = configSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "配置参数无效。" }, { status: 400 });
  }
  try {
    validateConfigValue(parsed.data.key, parsed.data.value);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "配置 value 必须是有效 JSON。" },
      { status: 400 }
    );
  }
  const item = await prisma.systemConfig.create({ data: parsed.data });
  logMutation("systemConfig", "create", { key: parsed.data.key });
  return NextResponse.json({ ok: true, item: maskConfigs([item])[0] });
});

export const PUT = withApiLog("PUT /api/system-config", async (req: Request) => {
  const parsed = configSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "配置参数无效。" }, { status: 400 });
  }

  // 密钥占位符 "********" → 合并已有值，避免脱敏回显覆盖真实密钥
  let value = parsed.data.value;
  if (
    parsed.data.key === LLM_CONFIG_KEY ||
    parsed.data.key === STORAGE_CONFIG_KEY ||
    parsed.data.key === OSS_CONFIG_KEY ||
    parsed.data.key === AGENT_CONFIG_KEY ||
    parsed.data.key === WECHAT_CONFIG_KEY
  ) {
    const existing = await prisma.systemConfig.findUnique({
      where: { key: parsed.data.key },
    });
    if (existing) value = mergeMaskedSecrets(parsed.data.key, existing.value, value);
  }

  try {
    validateConfigValue(parsed.data.key, value);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "配置 value 必须是有效 JSON。" },
      { status: 400 }
    );
  }

  const item = await prisma.systemConfig.upsert({
    where: { key: parsed.data.key },
    update: { value },
    create: { key: parsed.data.key, value },
  });
  logMutation("systemConfig", "update", { key: parsed.data.key });
  return NextResponse.json({ ok: true, item: maskConfigs([item])[0] });
});

export const DELETE = withApiLog("DELETE /api/system-config", async (req: Request) => {
  const parsed = deleteSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "删除参数无效。" }, { status: 400 });
  }
  await prisma.systemConfig.delete({ where: { key: parsed.data.key } });
  logMutation("systemConfig", "delete", { key: parsed.data.key });
  return NextResponse.json({ ok: true });
});

/** 保存时把脱敏占位 "********" 还原成 DB 中已有的真实密钥 */
function mergeMaskedSecrets(key: string, oldJson: string, newJson: string): string {
  try {
    const oldVal = JSON.parse(oldJson);
    const newVal = JSON.parse(newJson);
    if (key === LLM_CONFIG_KEY) {
      const oldList = (Array.isArray(oldVal) ? oldVal : [oldVal]) as Array<
        Record<string, unknown>
      >;
      const newList = (Array.isArray(newVal) ? newVal : [newVal]) as Array<
        Record<string, unknown>
      >;
      const merged = newList.map((item, i) => {
        if (item.apiKey === "********") {
          const old = oldList.find((o) => o.id === item.id) ?? oldList[i];
          return { ...item, apiKey: old?.apiKey ?? "" };
        }
        return item;
      });
      return JSON.stringify(merged, null, 2);
    }
    if (key === AGENT_CONFIG_KEY) {
      if (newVal.tavilyApiKey === "********" || newVal.tavilyApiKey === "") {
        newVal.tavilyApiKey = oldVal.tavilyApiKey ?? "";
      }
      if (newVal.githubToken === "********" || newVal.githubToken === "") {
        newVal.githubToken = oldVal.githubToken ?? "";
      }
      return JSON.stringify(newVal, null, 2);
    }
    if (key === WECHAT_CONFIG_KEY) {
      if (newVal.secret === "********" || newVal.secret === "") {
        newVal.secret = oldVal.secret ?? "";
      }
      return JSON.stringify(newVal, null, 2);
    }
    if (key === STORAGE_CONFIG_KEY) {
      return mergeStorageMaskedSecrets(oldJson, newJson);
    }
    // legacy OSS
    if (newVal.accessKeySecret === "********") {
      newVal.accessKeySecret = oldVal.accessKeySecret ?? "";
    }
    return JSON.stringify(newVal, null, 2);
  } catch {
    return newJson;
  }
}
