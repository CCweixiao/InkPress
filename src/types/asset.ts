/** 素材类型（与 Asset.kind 一致） */
export type AssetKind = "image" | "video" | "file";

/**
 * 统一的 Asset 类型，供前端各组件复用，避免各处本地类型漂移。
 * 字段与 Prisma Asset 模型对应；时间为 ISO 字符串（API 序列化后）。
 */
export type Asset = {
  id: string;
  /** 展示名：自动生成的短 UUID，如 a1b2c3d4.png */
  name: string;
  ossKey: string;
  url: string;
  kind: AssetKind;
  size: number;
  contentType: string;
  description: string;
  tagsJson: string;
  spaceId: string | null;
  articleId: string | null;
  createdAt: string;
  updatedAt: string;
};
