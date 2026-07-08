import { prisma } from "@/lib/db";
import { isValidTagColor } from "./tag-colors";

const CONFIG_KEY = "inkpress.snippetTagColors";

/** 读 SystemConfig，仅保留 value 为有效颜色的键。损坏/缺失 → {}。 */
export async function getTagColors(): Promise<Record<string, string>> {
  const row = await prisma.systemConfig.findUnique({
    where: { key: CONFIG_KEY },
  });
  if (!row) return {};
  try {
    const parsed = JSON.parse(row.value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof k === "string" && typeof v === "string" && isValidTagColor(v)) {
        out[k] = v;
      }
    }
    return out;
  } catch {
    return {};
  }
}

/** 读-改-写：color 有效则设，null/无效则删键；upsert 回 SystemConfig；返回最新全量。 */
export async function setTagColor(
  name: string,
  color: string | null
): Promise<Record<string, string>> {
  const current = await getTagColors();
  if (color == null || !isValidTagColor(color)) {
    delete current[name];
  } else {
    current[name] = color;
  }
  await prisma.systemConfig.upsert({
    where: { key: CONFIG_KEY },
    update: { value: JSON.stringify(current) },
    create: { key: CONFIG_KEY, value: JSON.stringify(current) },
  });
  return current;
}
