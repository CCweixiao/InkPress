import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { Editor } from "@tiptap/react";

/**
 * 自定义图片上传扩展（拖拽 / 粘贴图片 → 上传到微信素材库 → 插入）
 * 不依赖 Tiptap Cloud 的 FileHandler（付费）。
 * 上传走 /api/wechat/upload-material（kind=body），返回正文图 wx_src URL。
 */
export function createImageUploadExtension() {
  return Extension.create({
    name: "imageUpload",

    addProseMirrorPlugins() {
      const editor = this.editor as Editor;
      return [
        new Plugin({
          key: new PluginKey("imageUpload"),
          props: {
            handleDrop(view, event) {
              const files = getImages(event);
              if (!files.length) return false;
              event.preventDefault();
              const coords = view.posAtCoords({
                left: event.clientX,
                top: event.clientY,
              });
              void insertFiles(editor, files, coords?.pos ?? view.state.selection.from);
              return true;
            },
            handlePaste(view, event) {
              const files = getImages(event);
              if (!files.length) return false;
              void insertFiles(editor, files, view.state.selection.from);
              return true;
            },
          },
        }),
      ];
    },
  });
}

function getImages(event: DragEvent | ClipboardEvent): File[] {
  const dt =
    (event as DragEvent).dataTransfer ??
    (event as ClipboardEvent).clipboardData;
  if (!dt) return [];
  return Array.from(dt.files).filter((f) => f.type.startsWith("image/"));
}

/** 逐个上传：先插占位，上传成功后把占位 src 替换为真实微信 URL */
async function insertFiles(editor: Editor, files: File[], pos: number) {
  let insertPos = pos;
  for (const file of files) {
    const placeholder = URL.createObjectURL(file);
    editor.commands.insertContentAt(insertPos, {
      type: "image",
      attrs: { src: placeholder, alt: file.name },
    });
    insertPos += 1;

    try {
      const fd = new FormData();
      fd.append("media", file);
      fd.append("kind", "body");
      const res = await fetch("/api/wechat/upload-material", {
        method: "POST",
        body: fd,
      });
      const data = (await res.json()) as { url?: string; error?: string };
      if (data.url) {
        replaceImageSrc(editor, placeholder, data.url);
      }
    } catch {
      // 上传失败保留占位（可后续重试）
    } finally {
      URL.revokeObjectURL(placeholder);
    }
  }
}

/** 把文档中指定 src 的图片节点替换为新 src */
function replaceImageSrc(editor: Editor, from: string, to: string) {
  editor.commands.command(({ tr, state }) => {
    state.doc.descendants((node, nodePos) => {
      if (
        node.type.name === "image" &&
        node.attrs.src === from
      ) {
        tr.setNodeMarkup(nodePos, undefined, {
          ...node.attrs,
          src: to,
        });
      }
      return true;
    });
    return true;
  });
}
