export interface SnippetItem {
  id: string;
  title: string;
  content: string;
  kind: string;
  imageUrl: string | null;
  imageAssetId: string | null;
  imagesJson: string;
  quoteSource: string | null;
  linkUrl: string | null;
  linkTitle: string | null;
  linkDescription: string | null;
  linkImage: string | null;
  tagsJson: string;
  color: string | null;
  sourceArticleId: string | null;
  sourceUrl: string | null;
  aiSummary: string | null;
  usageCount: number;
  pinned: boolean;
  trashed: boolean;
  trashedAt: string | null;
  createdAt: string;
  updatedAt: string;
}
