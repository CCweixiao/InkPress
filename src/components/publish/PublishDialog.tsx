"use client";

import type { ThemeOption } from "@/components/editor/EditorWorkspace";
import { PublishEntryDialog } from "./PublishEntryDialog";

/**
 * 发布弹窗（薄壳）。
 *
 * 对外 API 与重构前完全一致，内部委托给 PublishEntryDialog（多渠道入口）。
 * EditorWorkspace 的调用点无需改动。
 */
export function PublishDialog(props: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  articleId: string;
  title: string;
  digest: string;
  coverMediaId: string | null;
  status: string;
  themes: ThemeOption[];
  defaultThemeId: string | null;
}) {
  return <PublishEntryDialog {...props} />;
}
