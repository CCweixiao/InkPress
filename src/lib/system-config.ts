export type JsonObject = Record<string, unknown>;

export function parseJsonConfigValue(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    throw new Error("配置 value 必须是有效 JSON。");
  }
}

export function parseJsonObjectOrArrayConfig(
  value: string,
  label = "配置"
): JsonObject | JsonObject[] {
  const raw = parseJsonConfigValue(value);
  const isObject = raw && typeof raw === "object";
  if (!isObject) throw new Error(`${label}必须是 JSON 对象或 JSON 数组。`);
  if (Array.isArray(raw)) {
    if (
      !raw.every(
        (item) => item && typeof item === "object" && !Array.isArray(item)
      )
    ) {
      throw new Error(`${label}数组中的每一项都必须是 JSON 对象。`);
    }
    return raw as JsonObject[];
  }
  return raw as JsonObject;
}
