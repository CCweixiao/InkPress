import { describe, expect, it } from "vitest";
import {
  isAccidentalInput,
  isCapabilityQuestion,
} from "../../src/lib/ai/capability-reply";

describe("isCapabilityQuestion", () => {
  it("命中常见能力/身份询问", () => {
    expect(isCapabilityQuestion("你能做什么")).toBe(true);
    expect(isCapabilityQuestion("你能做什么？")).toBe(true);
    expect(isCapabilityQuestion("你可以做什么呢")).toBe(true);
    expect(isCapabilityQuestion("你会干啥")).toBe(true);
    expect(isCapabilityQuestion("你能做哪些事")).toBe(true);
    expect(isCapabilityQuestion("帮助")).toBe(true);
    expect(isCapabilityQuestion("help")).toBe(true);
    expect(isCapabilityQuestion("你是谁")).toBe(true);
    expect(isCapabilityQuestion("介绍你自己")).toBe(true);
    expect(isCapabilityQuestion("你的功能有哪些")).toBe(true);
    expect(isCapabilityQuestion("功能介绍")).toBe(true);
  });

  it("容忍礼貌语与语气词", () => {
    expect(isCapabilityQuestion("你好，你能做什么")).toBe(true);
    expect(isCapabilityQuestion("请问你可以做什么呀")).toBe(true);
    expect(isCapabilityQuestion("嗨，帮助")).toBe(true);
  });

  it("不误伤带具体任务的请求（必须交给 Agent）", () => {
    expect(isCapabilityQuestion("你能帮我写一篇文章吗")).toBe(false);
    expect(isCapabilityQuestion("你能做什么，顺便帮我润色下标题")).toBe(false);
    expect(isCapabilityQuestion("帮我总结这篇文章")).toBe(false);
    expect(isCapabilityQuestion("什么是 RAG")).toBe(false);
    expect(isCapabilityQuestion("帮我分析下这个项目的架构")).toBe(false);
    expect(isCapabilityQuestion("你能帮我把这段改成更口语化的吗")).toBe(false);
  });

  it("空串/超长文本不命中", () => {
    expect(isCapabilityQuestion("")).toBe(false);
    expect(isCapabilityQuestion("   ")).toBe(false);
    // 长度超过 24（能力询问通常很短）→ 即便以「你能」开头也交给 Agent
    expect(
      isCapabilityQuestion(
        "你能帮我写一篇关于人工智能在医疗领域应用的深度报道文章并配上三张插图"
      )
    ).toBe(false);
  });
});

describe("isAccidentalInput", () => {
  it("命中纯符号/空内容/误触", () => {
    expect(isAccidentalInput("")).toBe(true);
    expect(isAccidentalInput("    ")).toBe(true);
    expect(isAccidentalInput(";;;;")).toBe(true);
    expect(isAccidentalInput("！！！！！")).toBe(true);
    expect(isAccidentalInput("/")).toBe(true);
    expect(isAccidentalInput("、、、")).toBe(true);
    expect(isAccidentalInput("！？")).toBe(true);
    expect(isAccidentalInput("👍")).toBe(true);
    expect(isAccidentalInput("啊")).toBe(true); // 单字，无可执行意图
  });

  it("不误伤正常输入", () => {
    expect(isAccidentalInput("写一篇文章")).toBe(false);
    expect(isAccidentalInput("你能做什么")).toBe(false);
    expect(isAccidentalInput("继续")).toBe(false);
    expect(isAccidentalInput("abc")).toBe(false);
    expect(isAccidentalInput("12345")).toBe(false);
    expect(isAccidentalInput("帮我润色下标题")).toBe(false);
  });
});
