import { parseJsonObjectOrArrayConfig } from "@/lib/system-config";
import { storageDir } from "@/lib/paths";
import { OSS_CONFIG_KEY, type OssConfig, parseOssConfig } from "@/lib/oss-config";
import { prisma } from "@/lib/db";

export const STORAGE_CONFIG_KEY = "inkpress.storage";

export type StorageProviderKind = "local" | "aliyun-oss";

export type StorageConfig = {
  defaultProvider: StorageProviderKind;
  providers: {
    local: {
      enabled: true;
    };
    aliyunOss?: OssConfig & {
      enabled: boolean;
    };
  };
};

export function defaultStorageConfig(): StorageConfig {
  return {
    defaultProvider: "local",
    providers: {
      local: { enabled: true },
    },
  };
}

function normalizeProvider(value: unknown): StorageProviderKind {
  return value === "aliyun-oss" || value === "oss" || value === "aliyunOss"
    ? "aliyun-oss"
    : "local";
}

function parseAliyunOssProvider(value: unknown): StorageConfig["providers"]["aliyunOss"] {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  const enabled = raw.enabled === true;
  if (!enabled) {
    return {
      enabled: false,
      bucket: typeof raw.bucket === "string" ? raw.bucket.trim() : "",
      domain: typeof raw.domain === "string" ? raw.domain.trim().replace(/\/+$/, "") : "",
      accessKeyId:
        typeof raw.accessKeyId === "string" ? raw.accessKeyId.trim() : "",
      accessKeySecret:
        typeof raw.accessKeySecret === "string" ? raw.accessKeySecret.trim() : "",
    };
  }
  const parsed = parseOssConfig(JSON.stringify(raw));
  return { ...parsed, enabled };
}

export function parseStorageConfig(value?: string | null): StorageConfig {
  if (!value?.trim()) return defaultStorageConfig();
  const raw = parseJsonObjectOrArrayConfig(value, "存储配置");
  if (Array.isArray(raw)) throw new Error("存储配置必须是 JSON 对象。");
  const record = raw as Record<string, unknown>;
  const providersRaw =
    record.providers && typeof record.providers === "object"
      ? (record.providers as Record<string, unknown>)
      : record;
  const aliyunRaw =
    providersRaw.aliyunOss ??
    providersRaw["aliyun-oss"] ??
    providersRaw.oss;
  const aliyunOss = parseAliyunOssProvider(aliyunRaw);
  let defaultProvider = normalizeProvider(record.defaultProvider ?? record.default);
  if (defaultProvider === "aliyun-oss" && !aliyunOss?.enabled) {
    defaultProvider = "local";
  }
  return {
    defaultProvider,
    providers: {
      local: { enabled: true },
      ...(aliyunOss ? { aliyunOss } : {}),
    },
  };
}

export function storageConfigToJson(config: StorageConfig) {
  return JSON.stringify(config, null, 2);
}

export function maskStorageConfigValue(value: string) {
  try {
    const parsed = parseStorageConfig(value);
    return storageConfigToJson({
      ...parsed,
      providers: {
        ...parsed.providers,
        ...(parsed.providers.aliyunOss
          ? {
              aliyunOss: {
                ...parsed.providers.aliyunOss,
                accessKeySecret: parsed.providers.aliyunOss.accessKeySecret
                  ? "********"
                  : "",
              },
            }
          : {}),
      },
    });
  } catch {
    return value;
  }
}

export function mergeStorageMaskedSecrets(oldJson: string, newJson: string) {
  const oldVal = parseStorageConfig(oldJson);
  const newVal = parseStorageConfig(newJson);
  if (
    newVal.providers.aliyunOss &&
    (newVal.providers.aliyunOss.accessKeySecret === "********" ||
      newVal.providers.aliyunOss.accessKeySecret === "")
  ) {
    newVal.providers.aliyunOss.accessKeySecret =
      oldVal.providers.aliyunOss?.accessKeySecret ?? "";
  }
  return storageConfigToJson(newVal);
}

export async function getStorageConfig(): Promise<StorageConfig> {
  const storage = await prisma.systemConfig.findUnique({
    where: { key: STORAGE_CONFIG_KEY },
  });
  if (storage) return parseStorageConfig(storage.value);

  const legacyOss = await prisma.systemConfig.findUnique({
    where: { key: OSS_CONFIG_KEY },
  });
  if (!legacyOss) return defaultStorageConfig();
  const oss = parseOssConfig(legacyOss.value);
  return {
    defaultProvider: "aliyun-oss",
    providers: {
      local: { enabled: true },
      aliyunOss: { ...oss, enabled: true },
    },
  };
}

export function localStorageDisplayPath() {
  return storageDir();
}

export async function hasAliyunOssStorageConfig() {
  const config = await getStorageConfig();
  return !!config.providers.aliyunOss?.enabled;
}
