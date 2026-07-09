const SNIPPET_TITLE_MAX_LENGTH = 50;

export function deriveSnippetTitle(content: string): string {
  return (
    content.trim().split("\n")[0]?.trim().slice(0, SNIPPET_TITLE_MAX_LENGTH) ||
    "无标题"
  );
}

export function resolveSnippetUpdateTitle(input: {
  currentTitle: string;
  content?: string;
  title?: string;
}): string | undefined {
  if (input.title !== undefined) return input.title;
  if (input.content === undefined) return undefined;
  return deriveSnippetTitle(input.content);
}
