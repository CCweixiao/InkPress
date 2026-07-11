import path from "node:path";

function safeSegment(value: string | null | undefined, fallback: string) {
  const cleaned = (value ?? "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned || fallback;
}

function join(...parts: string[]) {
  return path.posix.join(...parts.map((part) => part.replaceAll("\\", "/")));
}

export function spacePrefix(spaceId: string) {
  return join("spaces", safeSegment(spaceId, "unknown-space"));
}

export function articlePrefix(input: { articleId: string; spaceId?: string | null }) {
  if (input.spaceId) {
    return join(spacePrefix(input.spaceId), "articles", safeSegment(input.articleId, "unknown-article"));
  }
  return join("articles", safeSegment(input.articleId, "unknown-article"));
}

export function assetObjectPrefix(input: {
  kind: string;
  spaceId?: string | null;
  articleId?: string | null;
}) {
  const bucket = safeSegment(input.kind, "files");
  if (input.articleId) {
    return join(
      articlePrefix({ articleId: input.articleId, spaceId: input.spaceId }),
      "assets",
      bucket
    );
  }
  if (input.spaceId) return join(spacePrefix(input.spaceId), "assets", bucket);
  return join("library", "assets", bucket);
}

export function articleManifestPath(input: { articleId: string; spaceId?: string | null }) {
  return join(articlePrefix(input), "manifest.json");
}

export function spaceManifestPath(spaceId: string) {
  return join(spacePrefix(spaceId), "manifest.json");
}
