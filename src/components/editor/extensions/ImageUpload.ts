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

/**
 * 逐个上传：先插占位，上传成功后把占位 src 替换为真实 URL。
 *
 * 关键：上传失败时必须把占位节点从文档中移除。否则 blob: URL 会残留在
 * markdown 里，发布时服务端无法下载（blob 是浏览器内存引用），
 * 必然导致公众号正文图片缺失。
 */
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
      if (url) {
        replaceImageSrc(editor, placeholder, url);
      } else {
        // upload 返回 null（OSS + 微信都失败）→ 移除占位，插一段可见提示
        removeImageBySrc(editor, placeholder);
        editor.commands.insertContentAt(
          editor.state.selection.from,
          {
            type: "paragraph",
            content: [
              { type: "text", text: `〔图片「${file.name}」上传失败，请重试〕` },
            ],
          }
        );
      }
    } catch {
      // 异常：同样移除占位，避免 blob 残留
      removeImageBySrc(editor, placeholder);
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

/** 删除文档中指定 src 的图片节点（用于上传失败清理 blob 占位） */
function removeImageBySrc(editor: Editor, src: string) {
  editor.commands.command(({ tr, state }) => {
    let removed = false;
    state.doc.descendants((node, nodePos) => {
      if (removed) return false;
      if (node.type.name === "image" && node.attrs.src === src) {
        // deleteRange 需要 resolved pos；nodePos 是该节点起始位置
        tr.delete(nodePos, nodePos + node.nodeSize);
        removed = true;
        return false;
      }
      return true;
    });
    return true;
  });
}
