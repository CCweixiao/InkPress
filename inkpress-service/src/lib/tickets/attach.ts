export interface Attachment {
  key: string;
  name: string;
  size: number;
  contentType: string;
}

export interface SignedAttachment extends Attachment {
  url?: string;
}

/**
 * 对附件数组中的每个 key 签发短时效 URL。
 * 注意：signer 函数由 server-side 调用方注入（signObjectUrl 引用 oss.ts，仅 Node 可用）。
 * 在 server component 取数后调用，把带 url 的数组传给客户端组件渲染。
 */
export function signedAttachments(
  atts: Attachment[],
  signer: (key: string) => string
): SignedAttachment[] {
  return atts.map((a) => ({ ...a, url: signer(a.key) }));
}

/** 安全解析 attachments JSON 字段（DB 以 String 存储） */
export function parseAttachments(raw: unknown): Attachment[] {
  if (typeof raw !== "string") return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as Attachment[];
  } catch {
    return [];
  }
}
