# 灵感注入审核设计

## 目标

把写作助手中的灵感引用升级为可删除、可恢复的结构化标签，并在正式写作前由独立 AI 审核相关性与冗余性。只有用户应用审核结果后，本轮输入才进入主 Agent 上下文。

## Composer 文档

Composer 使用有序片段保存用户输入：

```ts
type ComposerSegment =
  | { type: "text"; text: string }
  | { type: "snippet"; id: string; title: string };
```

灵感片段在输入区显示为原子标签，带删除按钮。序列化时按片段顺序生成用户可读文本和 `{{snippet:id}}` 运行时标记。上下键历史直接恢复片段数组，不解析展示文本。

## 审核隔离

审核记录独立于 `AgentChatMessage`：

- `pending`：AI 已完成分析，等待用户决策。
- `applied`：用户确认，随后才把输入发送给主 Agent。
- `rejected`：整条输入放弃，Composer 恢复原文与灵感标签。

放弃记录不进入主 Agent 消息、会话摘要或 Claude Agent transcript。审核只读取当前文章、最近正式对话文本、本轮输入和本轮灵感。

## AI 输出

每条灵感输出：

- `matched`：相关性契合。
- `insufficient`：相关性不足，包含 0-100 分。
- `redundant`：同一 `snippetId + contentHash` 已在历史已应用审核中出现。

审核同时返回总体建议。详情面板展示逐条理由、建议和评分。

## 内容指纹

对标题、正文、类型、出处、链接信息和标签的稳定 JSON 计算 SHA-256。相同 ID 但 Hash 变化视为更新素材，重新审核；相同 ID 与 Hash 才判定冗余。

## 交互

1. 用户发送含灵感的输入。
2. 输入区清空，对话区显示审核中的临时状态。
3. AI 完成后显示审核卡片。
4. “应用本轮素材”发送正式消息并启动主 Agent。
5. “放弃并调整”不发送正式消息，恢复整条 Composer 文档。
6. 刷新后仍显示待审核记录；最近 50 条正式输入与放弃草稿可用于上下键历史。

