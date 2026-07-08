export function isSafeMarkdownUrl(url: string): boolean {
  const value = url.trim();
  if (!value) return false;
  if (/^https?:\/\//i.test(value)) return true;
  return value.startsWith("/") && !value.startsWith("//");
}
