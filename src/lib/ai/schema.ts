import { z } from "zod";

/** 文章大纲 schema（用于 generateObject） */
export const outlineSchema = z.object({
  title: z.string().describe("文章主标题"),
  sections: z
    .array(
      z.object({
        heading: z.string().describe("小节标题（不含 # 前缀）"),
        summary: z
          .string()
          .describe("该小节要写的内容要点，1-2 句话，供后续逐节展开"),
      })
    )
    .min(3)
    .max(8)
    .describe("文章小节列表，3-8 节，逻辑递进"),
});

export type Outline = z.infer<typeof outlineSchema>;
