export type MarkdownImage = {
  alt: string;
  src: string;
};

const imagePattern = /!\[([^\]\n]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

export function extractMarkdownImages(markdown: string): MarkdownImage[] {
  return Array.from(markdown.matchAll(imagePattern), (match) => ({
    alt: match[1] || "image",
    src: match[2],
  }));
}

export function getFirstMarkdownImage(markdown: string): MarkdownImage | null {
  const match = imagePattern.exec(markdown);
  imagePattern.lastIndex = 0;
  if (!match) return null;
  return {
    alt: match[1] || "image",
    src: match[2],
  };
}

export function stripMarkdownImages(markdown: string): string {
  return markdown
    .replace(imagePattern, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
