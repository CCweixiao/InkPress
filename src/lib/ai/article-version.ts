import { createHash } from "node:crypto";

export function articleVersionHash(input: {
  title?: string | null;
  markdown: string;
  digest?: string | null;
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        title: input.title ?? "",
        markdown: input.markdown,
        digest: input.digest ?? "",
      })
    )
    .digest("hex");
}
