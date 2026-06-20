import fs from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/db";

const THEMES_DIR = path.join(process.cwd(), "themes");
const CODE_DIR = path.join(THEMES_DIR, "code");

/** 内置主题清单（对应 themes/markdown/*.css） */
export const BUILTIN_THEMES = [
  {
    name: "默认主题",
    file: "default.css",
    primaryColor: "#3f51b5",
  },
  {
    name: "优雅主题",
    file: "grace.css",
    primaryColor: "#3f51b5",
  },
  {
    name: "简洁主题",
    file: "simple.css",
    primaryColor: "#3f51b5",
  },
] as const;

/** 可用的代码高亮主题 */
export const CODE_THEMES = [
  "atom-one-dark",
  "atom-one-light",
  "github",
  "monokai",
  "vs2015",
  "xcode",
] as const;

/** 读取 markdown 主题 CSS 文件内容 */
export async function readThemeCss(file: string): Promise<string> {
  return fs.readFile(path.join(THEMES_DIR, "markdown", file), "utf8");
}

/** 读取代码高亮主题 CSS 文件内容 */
export async function readCodeThemeCss(codeTheme: string): Promise<string> {
  try {
    return await fs.readFile(path.join(CODE_DIR, `${codeTheme}.css`), "utf8");
  } catch {
    // 兜底
    return fs.readFile(path.join(CODE_DIR, "atom-one-dark.css"), "utf8");
  }
}

/** 启动时 seed 内置主题（若不存在） */
export async function seedBuiltInThemes() {
  for (const t of BUILTIN_THEMES) {
    const existing = await prisma.theme.findFirst({
      where: { name: t.name, isBuiltIn: true },
    });
    if (existing) continue;
    let cssContent = "";
    try {
      cssContent = await readThemeCss(t.file);
    } catch {
      continue;
    }
    await prisma.theme.create({
      data: {
        name: t.name,
        cssContent,
        codeTheme: "atom-one-dark",
        primaryColor: t.primaryColor,
        isBuiltIn: true,
      },
    });
  }
}

/**
 * 解析主题 CSS 中的 CSS 变量为实际值
 * - var(--md-primary-color) → primaryColor
 * - var(--md-font-size) → 16px
 * - hsl(var(--foreground)) → #1a1a1a（公众号无 CSS 变量，必须内联前解析）
 */
export function resolveCssVariables(css: string, primaryColor: string): string {
  return css
    .replace(/var\(--md-primary-color\)/g, primaryColor)
    .replace(/var\(--md-primary-color-dark\)/g, darken(primaryColor))
    .replace(/var\(--md-primary-color-light\)/g, lighten(primaryColor))
    .replace(/var\(--md-primary-color-bg\)/g, `${primaryColor}10`)
    .replace(/var\(--md-font-size\)/g, "16px")
    .replace(/hsl\(var\(--foreground\)\)/g, "#1a1a1a")
    .replace(/hsl\(var\(--muted-foreground\)\)/g, "#999")
    .replace(/hsl\(var\(--background\)\)/g, "#ffffff");
}

/** hex 颜色加深（简单近似） */
function darken(hex: string): string {
  return shift(hex, -0.15);
}
/** hex 颜色变亮（简单近似） */
function lighten(hex: string): string {
  return shift(hex, 0.15);
}
function shift(hex: string, amount: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const num = parseInt(m[1], 16);
  let r = (num >> 16) & 0xff;
  let g = (num >> 8) & 0xff;
  let b = num & 0xff;
  r = clamp(Math.round(r + r * amount));
  g = clamp(Math.round(g + g * amount));
  b = clamp(Math.round(b + b * amount));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}
function clamp(v: number): number {
  return Math.max(0, Math.min(255, v));
}
