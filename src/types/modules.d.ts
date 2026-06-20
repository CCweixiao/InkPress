declare module "markdown-it-footnote";
declare module "markdown-it-task-lists";
declare module "@traptitech/markdown-it-katex";
declare module "jsdom" {
  export class JSDOM {
    constructor(html?: string, options?: Record<string, unknown>);
    readonly window: Window & typeof globalThis;
  }
}
