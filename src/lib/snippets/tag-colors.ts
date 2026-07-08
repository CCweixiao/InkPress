export const TAG_COLOR_NAMES = [
  "amber",
  "blue",
  "green",
  "rose",
  "purple",
  "orange",
  "teal",
  "slate",
] as const;
export type TagColorName = typeof TAG_COLOR_NAMES[number];
export const DEFAULT_TAG_COLOR: TagColorName = "slate";

export type TagColorClasses = {
  dot: string;
  pill: string;
  active: string;
  text: string;
};

// 静态 Tailwind 类（禁动态拼接，防 JIT purge）
const TAG_COLOR_CLASSES: Record<TagColorName, TagColorClasses> = {
  amber: {
    dot: "bg-amber-500",
    pill: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
    active:
      "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30",
    text: "text-amber-600 dark:text-amber-400",
  },
  blue: {
    dot: "bg-blue-500",
    pill: "bg-blue-500/10 text-blue-700 dark:text-blue-300",
    active:
      "bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-500/30",
    text: "text-blue-600 dark:text-blue-400",
  },
  green: {
    dot: "bg-green-500",
    pill: "bg-green-500/10 text-green-700 dark:text-green-300",
    active:
      "bg-green-500/10 text-green-700 dark:text-green-300 border-green-500/30",
    text: "text-green-600 dark:text-green-400",
  },
  rose: {
    dot: "bg-rose-500",
    pill: "bg-rose-500/10 text-rose-700 dark:text-rose-300",
    active: "bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/30",
    text: "text-rose-600 dark:text-rose-400",
  },
  purple: {
    dot: "bg-purple-500",
    pill: "bg-purple-500/10 text-purple-700 dark:text-purple-300",
    active:
      "bg-purple-500/10 text-purple-700 dark:text-purple-300 border-purple-500/30",
    text: "text-purple-600 dark:text-purple-400",
  },
  orange: {
    dot: "bg-orange-500",
    pill: "bg-orange-500/10 text-orange-700 dark:text-orange-300",
    active:
      "bg-orange-500/10 text-orange-700 dark:text-orange-300 border-orange-500/30",
    text: "text-orange-600 dark:text-orange-400",
  },
  teal: {
    dot: "bg-teal-500",
    pill: "bg-teal-500/10 text-teal-700 dark:text-teal-300",
    active:
      "bg-teal-500/10 text-teal-700 dark:text-teal-300 border-teal-500/30",
    text: "text-teal-600 dark:text-teal-400",
  },
  slate: {
    dot: "bg-slate-400",
    pill: "bg-muted text-muted-foreground",
    active: "bg-primary/10 text-primary border-primary/30",
    text: "text-muted-foreground",
  },
};

export function isValidTagColor(
  color: string | null | undefined
): color is TagColorName {
  return color != null && (TAG_COLOR_NAMES as readonly string[]).includes(color);
}

export function getTagColorClasses(
  color: string | null | undefined
): TagColorClasses {
  return isValidTagColor(color)
    ? TAG_COLOR_CLASSES[color]
    : TAG_COLOR_CLASSES[DEFAULT_TAG_COLOR];
}

export function resolveTagColor(
  tag: string,
  tagColors: Record<string, string>
): string | null {
  const v = tagColors[tag];
  return isValidTagColor(v) ? v : null;
}
