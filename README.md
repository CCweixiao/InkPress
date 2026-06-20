# InkPress · AI 公众号写作台

AI 驱动的微信公众号文章编写与发布系统：**主题/要求/素材 → AI 流式生成 → 实时预览 → 一键推送草稿箱**。

前后端全部 Node（Next.js App Router），编辑器用 Tiptap，转换内核自建 juice 内联引擎，AI 用 Vercel AI SDK，数据用 Prisma + SQLite（零运维）。

## 功能

- **AI 生成**：填主题 + 要求 + 素材，流式输出公众号 Markdown 文章（Anthropic Claude / OpenAI GPT 可切换）
- **Markdown 编辑**：Tiptap 编辑器，所见即所得 + 源码双向，拖拽/粘贴图片自动上传微信素材库
- **多主题排版**：内置 doocs/md 主题（默认/优雅/简洁）+ 6 个代码高亮主题，CSS 可在线自定义，主题色可调
- **公众号实时预览**：右侧手机壳实时渲染，所见即所得
- **格式转换**：自建 `markdown-it + highlight.js + juice` 内联引擎，输出微信公众号编辑器兼容的内联样式 HTML
- **草稿箱发布**：一键推送至公众号草稿箱（含封面/正文图自动上传、外链防盗链处理），发布由人工在后台完成

## 技术栈

| 层 | 选型 |
|----|------|
| 框架 | Next.js 16 (App Router) + React 19 + TypeScript |
| UI | Tailwind CSS v4 + shadcn 风格组件 + Radix Primitives |
| 编辑器 | Tiptap v3（StarterKit + Image + TaskList + 自定义图片上传扩展） |
| AI | Vercel AI SDK v6（`ai` + `@ai-sdk/anthropic` + `@ai-sdk/openai` + `@ai-sdk/react`） |
| 转换内核 | markdown-it 14 + highlight.js 11 + juice 12 + jsdom + katex |
| 主题 | vendor 自 doocs/md 的 CSS + highlight.js 代码主题 |
| 微信 API | 手写 fetch 客户端（stable_token 缓存 + uploadimg + add_material + draft/add） |
| 数据 | Prisma 7 + SQLite（better-sqlite3 adapter） |

## 快速开始

```bash
# 1. 安装依赖
pnpm install

# 2. 配置环境变量
cp .env.example .env
# 编辑 .env 填写 WX_APPID / WX_SECRET / ANTHROPIC_API_KEY 等

# 3. 初始化数据库 + 生成主题
pnpm prisma migrate dev
pnpm db:generate
pnpm db:seed      # 内置 3 个主题

# 4. 启动
pnpm dev          # http://localhost:3000
```

## 环境变量

| 变量 | 说明 |
|------|------|
| `DATABASE_URL` | SQLite 文件路径，默认 `file:./dev.db` |
| `WX_APPID` | 微信公众号 AppID |
| `WX_SECRET` | 微信公众号 AppSecret |
| `ANTHROPIC_API_KEY` | Anthropic API Key（用 Claude 时必填） |
| `OPENAI_API_KEY` | OpenAI API Key（用 GPT 时必填，可选） |
| `AI_MODEL` | 模型规格 `<provider>:<model>`，默认 `anthropic:claude-3-5-sonnet-latest` |

## 微信公众号配置

1. **获取凭证**：微信公众平台 → 设置与开发 → 基本配置，获取 AppID / AppSecret，填入 `.env`。
2. **IP 白名单**：基本配置 → IP 白名单，加入**服务器出口 IP**（本地开发为你的公网 IP）。漏配会报 `errcode 40164`。
3. **账号类型**：本系统仅推送**草稿箱**，订阅号/认证号均可使用；正式群发在公众号后台手动操作。

## 转换引擎说明（核心）

`src/lib/convert/to-wechat.ts` 实现 8 步流水线，把 Markdown 转成微信公众号编辑器兼容的内联样式 HTML：

1. 剥离 front-matter
2. 图片外链 → 微信素材 URL（`media/uploadimg`，防盗链必需）
3. markdown-it 渲染（含 hljs 代码高亮、katex 公式、脚注、任务列表）
4. 拼装 `<div id="nice">` + 4 段 `<style>`（基础/主题/代码/字体）
5. 解析 `var(--md-primary-color)` 等 CSS 变量
6. `juice` 内联全部 CSS 到元素 `style` 属性
7. 微信专项清洗（删 script/style、锚点链接去 href、嵌套列表、img 尺寸内联、首尾空 p 占位）

## 项目结构

```
src/
├─ app/
│  ├─ page.tsx                 # 文章列表/工作台
│  ├─ editor/[id]/page.tsx     # 主写作页（AI + 编辑器 + 预览 三栏）
│  ├─ themes/page.tsx          # 主题管理
│  ├─ settings/page.tsx        # 配置状态
│  └─ api/
│     ├─ articles/             # 文章 CRUD
│     ├─ themes/               # 主题 CRUD
│     ├─ ai/generate/          # 流式生成
│     ├─ preview/              # 服务端 juice 全量转换
│     ├─ wechat/               # upload-material + draft
│     └─ settings/status/
├─ components/                 # UI 组件（editor/preview/publish/themes/ui）
└─ lib/
   ├─ ai/                      # provider + prompts
   ├─ convert/                 # ★ 转换引擎
   ├─ markdown/                # markdown-it 渲染器
   ├─ themes/                  # 主题加载/变量解析/seed
   └─ wechat/                  # token/material/draft
themes/
├─ markdown/                   # 内置主题 CSS（default/grace/simple）
└─ code/                       # hljs 代码高亮主题
prisma/
├─ schema.prisma               # Article / Theme / Material
└─ seed.ts                     # 内置主题 seed
```

## 常用命令

```bash
pnpm dev            # 开发
pnpm build          # 生产构建
pnpm typecheck      # 类型检查
pnpm db:migrate     # 创建/应用迁移
pnpm db:generate    # 生成 Prisma Client
pnpm db:seed        # 种子内置主题
pnpm db:studio      # Prisma Studio 可视化数据
```

## 许可

MIT。内置主题 CSS 源自 [doocs/md](https://github.com/doocs/md)（Apache-2.0），代码高亮主题源自 [highlight.js](https://github.com/highlightjs/highlight.js)（BSD-3-Clause）。
