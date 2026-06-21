# InkPress · AI 公众号写作台

AI 驱动的微信公众号文章编写与发布系统：**主题/要求/素材 → AI 流式生成 → 实时预览 → 一键推送草稿箱**。

前后端全部 Node（Next.js App Router），编辑器用 Tiptap，转换内核自建 juice 内联引擎，AI 用 Vercel AI SDK，数据用 Prisma + SQLite（零运维）。

## 功能

- **空间分类**：用「空间」按主题分类文章（名称、描述、标签），支持列表/网格视图；空间下有文章时禁止删除
- **文章组织**：进入空间查看文章（时间倒序），网格卡片显示封面+标题+摘要，无封面用内置 SVG 占位，文字过多自动截断并悬浮显示全文
- **回收站**：文章 / 空间 / 素材删除后先进回收站，默认保留 30 天，到期自动清理；支持随时恢复或彻底删除
- **AI 生成**：填主题 + 要求 + 素材，流式输出公众号 Markdown 文章；支持配置多个模型供应商（OpenAI / 智谱 GLM / DeepSeek 等 OpenAI 兼容协议），编辑器内可随时切换
- **编辑器素材管理**：编辑器左侧新增「素材」Tab，管理当前文章素材，支持拖拽/多文件上传、**分片上传 + 断点续传 + 失败自动重试**、防重命名、一键插入正文
- **素材库目录**：`/materials` 按「空间 → 文章」目录组织素材，文章删除时其素材一并进回收站
- **模型配置**：在「设置」页可视化配置 AI 模型供应商与 OSS 存储，配置存数据库，AI 接口自动加载（未配置时回退到 `.env`）
- **文件存储正文**：文章正文以 Markdown 文件存储在 `storage/articles/`，数据库只存相对路径（适配不同部署环境）
- **Markdown 编辑**：Tiptap 编辑器，所见即所得 + 源码双向，拖拽/粘贴图片自动上传（OSS 优先，微信素材库兜底）
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
| AI | Vercel AI SDK v6（`ai` + `@ai-sdk/openai-compatible` + `@ai-sdk/react`，统一兼容协议） |
| 对象存储 | 阿里云 OSS（`ali-oss`） |
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
# 编辑 .env 填写 WX_APPID / WX_SECRET（AI 模型与 OSS 可在「设置」页配置）

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
| `AI_MODEL` | AI 兜底模型规格 `<provider>:<model>`，默认 `anthropic:claude-3-5-sonnet-latest` |
| `ANTHROPIC_API_KEY` | AI 兜底（未在设置页配置模型时使用） |
| `OPENAI_API_KEY` | AI 兜底（未在设置页配置模型时使用） |

> **AI 模型**与 **OSS 配置**推荐在「设置」页可视化配置（存数据库）。`.env` 中的 `AI_MODEL` / `*_API_KEY` 仅作为未配置时的兜底。

## AI 模型配置

进入「设置 → AI 模型」，可配置多个 OpenAI 兼容协议的供应商（OpenAI、智谱 GLM、DeepSeek 等）：

- 点击「OpenAI / 智谱 GLM / DeepSeek」快捷添加预设，或「添加自定义供应商」
- 填写 Base URL、API Key、模型列表（每行一个），设置一个为「默认」
- 保存后，编辑器 AI 面板顶部的「供应商 / 模型」下拉即可选用；AI 接口会自动加载所选配置
- 配置 key 为 `inkpress.llm`（JSON 数组，存 `SystemConfig` 表）

## OSS 配置

进入「设置 → OSS 存储」，填写阿里云 OSS 的 Bucket、Domain（CDN 域名或 OSS 默认域名）、AccessKeyId/Secret，可点击「测试连接」验证。配置后：

- 「素材」页可上传图片/视频/文件，复制外链插入文章
- 编辑器拖拽/粘贴图片会优先上传到 OSS 拿稳定外链（未配置时回退微信素材库）
- 发布时，`to-wechat.ts` 会把 OSS 外链图统一转成公众号 src（防盗链）
- 配置 key 为 `inkpress.oss`（JSON 对象，存 `SystemConfig` 表）

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
│  ├─ page.tsx                 # 首页：空间分区 + 文章列表
│  ├─ editor/[id]/page.tsx     # 主写作页（AI + 编辑器 + 预览 三栏）
│  ├─ spaces/[id]/page.tsx     # 空间详情：文章组织（列表/网格）
│  ├─ recycle/page.tsx         # 回收站（恢复 / 彻底删除 / 过期清理）
│  ├─ themes/page.tsx          # 主题管理
│  ├─ materials/page.tsx       # 素材库（空间→文章 目录）
│  ├─ settings/page.tsx        # 系统配置（AI 模型 / OSS / 微信）
│  └─ api/
│     ├─ articles/             # 文章 CRUD（正文读写文件）
│     ├─ spaces/               # 空间 CRUD
│     ├─ recycle/              # 回收站 list / cleanup / restore / purge
│     ├─ themes/               # 主题 CRUD
│     ├─ ai/                   # generate / outline / generate-sections / providers
│     ├─ preview/              # 服务端 juice 全量转换
│     ├─ wechat/               # upload-material + draft
│     ├─ upload/               # 通用 OSS 上传（+ chunk 分片续传）
│     ├─ materials/            # 素材列表（按空间/文章过滤）/ 软删
│     ├─ system-config/        # 系统配置 CRUD + test
│     └─ settings/status/      # 微信配置只读状态
├─ components/                 # UI 组件（articles/spaces/recycle/editor/materials/settings...）
└─ lib/
   ├─ content-store.ts         # ★ 文章正文文件读写
   ├─ recycle.ts               # 软删清理 / 彻底删除辅助
   ├─ ai/                      # provider + llm-config + prompts
   ├─ convert/                 # ★ 转换引擎
   ├─ oss.ts / oss-config.ts   # OSS 客户端（含 multipartUpload）
   └─ ...
storage/                       # ★ 文章正文 + 上传临时分片（不提交 git）
├─ articles/<id>.md
└─ tmp/<uploadId>/
public/covers/                 # 无封面占位 SVG
themes/
├─ markdown/                   # 内置主题 CSS（default/grace/simple）
└─ code/                       # hljs 代码高亮主题
prisma/
├─ schema.prisma               # Article / Space / Theme / Material / SystemConfig / Asset
├─ seed.ts                     # 内置主题 seed
└─ scripts/
   └─ migrate-content-to-files.ts  # 正文迁移到文件（一次性，升级时运行）
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
