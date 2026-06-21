import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { Editor } from "@tiptap/react";

/**
 * 自定义图片上传扩展（拖拽 / 粘贴图片 → 上传 → 插入）
 * 不依赖 Tiptap Cloud 的 FileHandler（付费）。
 *
 * 上传优先走 OSS（/api/upload，返回稳定外链）。
 * OSS 未配置或上传失败时，回退到微信公众号素材库（/api/wechat/upload-material，
 * 返回正文图 wx_src URL）。发布时 to-wechat.ts 会把外链图统一转成微信 src。
 */
export function createImageUploadExtension(articleId?: string) {
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
              void insertFiles(editor, files, coords?.pos ?? view.state.selection.from, articleId);
              return true;
            },
            handlePaste(view, event) {
              const files = getImages(event);
              if (!files.length) return false;
              void insertFiles(editor, files, view.state.selection.from, articleId);
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

/** 逐个上传：先插占位，上传成功后把占位 src 替换为真实 URL */
async function insertFiles(editor: Editor, files: File[], pos: number, articleId?: string) {
  let insertPos = pos;
  for (const file of files) {
    const placeholder = URL.createObjectURL(file);
    editor.commands.insertContentAt(insertPos, {
      type: "image",
      attrs: { src: placeholder, alt: file.name },
    });
    insertPos += 1;

    try {
      const url = await uploadImage(file, articleId);
      if (url) replaceImageSrc(editor, placeholder, url);
    } catch {
      // 上传失败保留占位（可后续重试）
    } finally {
      URL.revokeObjectURL(placeholder);
    }
  }
}

/** 优先 OSS，失败回退微信素材库 */
async function uploadImage(file: File, articleId?: string): Promise<string | null> {
  // 1) OSS
  try {
    const fd = new FormData();
    fd.append("file", file);
    if (articleId) fd.append("articleId", articleId);
    const res = await fetch("/api/upload", { method: "POST", body: fd });
    if (res.ok) {
      const data = (await res.json()) as {
        asset?: { url?: string };
        error?: string;
      };
      if (data.asset?.url) return data.asset.url;
    }
  } catch {
    // fallthrough to wechat
  }

  // 2) 微信素材库兜底
  const fd = new FormData();
  fd.append("media", file);
  fd.append("kind", "body");
  const res = await fetch("/api/wechat/upload-material", {
    method: "POST",
    body: fd,
  });
  const data = (await res.json()) as { url?: string; error?: string };
  return data.url ?? null;
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
