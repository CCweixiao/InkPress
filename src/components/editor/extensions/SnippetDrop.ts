import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { Editor } from "@tiptap/react";
import { snippetToMarkdown, type SnippetLike } from "@/lib/ai/snippet-markdown";

const SNIPPET_MIME = "application/x-snippet";

/**
 * 拖拽灵感素材插入编辑区。
 * 面板卡片 onDragStart 写 application/x-snippet 载荷（JSON），此扩展 handleDrop
 * 读载荷 → snippetToMarkdown → insertContentAt(dropPos, md)（tiptap-markdown 解析为富文本）。
 * 非 snippet 载荷（图片文件 / 外部文本）→ return false，让 ImageUpload / TipTap 默认处理。
 */
export function createSnippetDropExtension() {
  return Extension.create({
    name: "snippetDrop",

    addProseMirrorPlugins() {
      const editor = this.editor as Editor;
      return [
        new Plugin({
          key: new PluginKey("snippetDrop"),
          props: {
            handleDrop(view, event) {
              const dt = event.dataTransfer;
              if (!dt) return false;
              const raw = dt.getData(SNIPPET_MIME);
              if (!raw) return false;
              let snippet: SnippetLike;
              try {
                snippet = JSON.parse(raw) as SnippetLike;
              } catch {
                return false;
              }
              event.preventDefault();
              const coords = view.posAtCoords({
                left: event.clientX,
                top: event.clientY,
              });
              const pos = coords?.pos ?? view.state.selection.from;
              editor.commands.insertContentAt(pos, snippetToMarkdown(snippet));
              return true;
            },
          },
        }),
      ];
    },
  });
}
