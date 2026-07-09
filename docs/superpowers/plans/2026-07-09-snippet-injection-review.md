# 灵感注入审核实现计划

> **面向 AI 代理的工作者：** 使用 TDD 逐任务实现，保持主 Agent 与审核上下文隔离。

**目标：** 实现结构化灵感标签、独立 AI 审核和可恢复的应用/放弃闭环。

**架构：** Composer 文档负责稳定回显；`SnippetInjectionReview` 保存独立审核状态；审核服务使用当前模型执行结构化语义判断；只有 applied 记录会转换为正式主 Agent 消息。

**技术栈：** Next.js、React、Prisma、AI SDK `generateObject`、Zod、Vitest。

---

### 任务 1：纯逻辑契约

**文件：**
- 创建：`src/lib/snippets/injection-review.ts`
- 创建：`tests/unit/snippet-injection-review.test.ts`
- 修改：`src/lib/ai/snippet-serialize.ts`

- [ ] 先写 Composer 文档序列化、Hash 和冗余判断失败测试。
- [ ] 实现最小纯函数并运行测试。

### 任务 2：审核持久化与 AI 服务

**文件：**
- 修改：`prisma/schema.prisma`
- 创建：`prisma/migrations/20260709020000_snippet_injection_reviews/migration.sql`
- 创建：`src/lib/snippets/injection-review-agent.ts`
- 创建：`src/app/api/ai/snippet-reviews/route.ts`
- 创建：`src/app/api/ai/snippet-reviews/[id]/route.ts`

- [ ] 增加独立审核模型与迁移。
- [ ] 使用 `generateObject` 输出结构化审核结果。
- [ ] 实现创建、应用、放弃和列表接口；应用接口返回正式发送载荷。

### 任务 3：结构化 Composer

**文件：**
- 修改：`src/components/editor/ChatComposer.tsx`
- 修改：`src/components/editor/WritingAssistant.tsx`

- [ ] 用分段渲染输入和可删除灵感标签。
- [ ] 选择灵感时在当前光标位置插入片段。
- [ ] 上下键恢复结构化历史；放弃审核时恢复原文。

### 任务 4：对话审核卡片

**文件：**
- 创建：`src/components/editor/SnippetReviewCard.tsx`
- 修改：`src/components/editor/WritingAssistant.tsx`

- [ ] 展示审核状态、分类统计和详情。
- [ ] 应用后启动主 Agent；放弃后恢复 Composer。
- [ ] 删除旧发送前关联性弹窗。

### 任务 5：验证

- [ ] 运行相关 Vitest。
- [ ] 运行 `pnpm typecheck`。
- [ ] 运行 `pnpm build`。
- [ ] 浏览器验证标签删除、审核详情、应用、放弃回填和上下键历史。

