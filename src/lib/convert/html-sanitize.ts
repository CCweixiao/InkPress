/**
 * 通用 HTML 清洗工具（正则实现，不引入 jsdom 依赖）。
 *
 * 仅用于「导出可粘贴 HTML」类渠道（知乎/掘金/博客园/通用）的后处理：
 * 微信渠道走 finalizeForWeChat（基于 jsdom 的完整清洗，见 to-wechat.ts），
 * 不经过本文件。
 *
 * 设计原则：只做对所有富文本编辑器都安全的无害处理——保留原生 ul/ol/li、
 * 保留 inline style、保留锚点；仅清理 juice 残留的 <style> 标签，以及把
 * <img> 的 width/height 属性镜像到 style（部分编辑器只认 inline style）。
 */

/**
 * 删除残留的 <script> / <style> 标签及其内容。
 *
 * juice 全内联后，原始 <style> 标签本身仍会保留在 HTML 中（juice 只把规则
 * 复制到元素的 inline style，不删除源 <style>）。富文本编辑器粘贴时会过滤
 * <style>，但保留它们会让复制出的 HTML 夹带大段 CSS 文本，故在此正则清除。
 *
 * 标签内容里不会出现其自身的闭合标签，非贪婪匹配到首个 </style>/</script>
 * 与 HTML 解析器行为一致。
 */
export function stripUnsafeTags(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "");
}

/**
 * 把 <img> 的 width/height 属性值镜像到 inline style。
 *
 * 与微信 finalize 的 jsdom 版语义一致：保留原属性、只把值追加进 style
 * （富文本编辑器普遍优先识别 inline style）。无 width/height 的 img 不动。
 */
export function inlineImageDimensions(html: string): string {
  return html.replace(/<img\b[^>]*>/gi, (tag) => {
    const widthVal = readAttr(tag, "width");
    const heightVal = readAttr(tag, "height");
    if (!widthVal && !heightVal) return tag;

    const existingStyle = /style\s*=\s*"([^"]*)"/i.exec(tag)?.[1] ?? "";
    const extra = [
      existingStyle,
      widthVal ? `width:${widthVal}px` : "",
      heightVal ? `height:${heightVal}px` : "",
    ]
      .filter(Boolean)
      .join(";")
      .replace(/^;/, "");

    // 已有 style → 替换其值；否则在闭合 > 前注入 style 属性
    if (/style\s*=\s*"/i.test(tag)) {
      return tag.replace(/\s*style\s*=\s*"[^"]*"/i, ` style="${extra}"`);
    }
    return tag.replace(/(\/?)>$/, ` style="${extra}"$1>`);
  });
}

/** 读取 HTML 标签字符串里的某个属性值（支持双引号/单引号/无引号三种写法）。 */
function readAttr(tag: string, name: string): string | undefined {
  const m = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag);
  return m?.[2] ?? m?.[3] ?? m?.[4];
}
