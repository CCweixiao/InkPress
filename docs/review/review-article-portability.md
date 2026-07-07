# Review 指引：文章导出/导入（ZIP + 单 MD + 媒体提取）

> 供审核 AI 使用。假定你可访问本仓库。建议阅读顺序：纯层 → 服务层 → 两个路由 → 两个组件 → 测试。

## 一、背景与目标

为 InkPress 增加文章级**导出/导入**，用于跨实例/跨空间搬迁与备份：

- **导出**：写作助手页（`/editor/[id]`）发布按钮旁「导出」→ ZIP（正文 MD + 文章元数据 JSON + 素材元数据 JSON；本地素材内嵌二进制，云素材仅元数据）。
- **导入**：首页每空间「新建文章」旁「导入文章」+ 未分类区块。**支持批量**、**支持单 MD**：
  - `.zip`：解包重建文章 + 素材（本地二进制重传 + 正文链接改写）。
  - `.md`：派生标题/摘要、剥 front-matter、提取远程媒体建**引用型**素材。
  - 空 MD 拒绝；批量逐文件独立成败。

正文本身是 Markdown（Tiptap + `tiptap-markdown`），无 HTML↔MD 转换。

## 二、改动清单（文件 → 职责）

**新增**
| 文件 | 职责 |
|---|---|
| `src/lib/article-portability.ts` | **纯转换层**（无 I/O）：zod schemas、`buildArticleExportZip`、`parseArticleImportZip`、`entryPathError`、`rewriteImageLinks`、`collectLocalStorageIdsFromMd`、`isCloudAssetUrl`、`assetBinaryPath`、`deriveArticleFromMarkdown`、`extractMediaFromMarkdown`、`detectImportKind` |
| `src/lib/article-portability-service.ts` | **服务层**（DB+存储编排）：`AssetInput`、`importOneArticle`、`exportArticleToZip`、`materialsToAssetInputs` |
| `src/app/api/articles/[id]/export/route.ts` | 导出路由（薄适配） |
| `src/app/api/articles/import/route.ts` | 导入路由（薄适配，批量） |
| `src/components/editor/ExportArticleButton.tsx` | 导出按钮 |
| `src/components/articles/ImportArticleButton.tsx` | 导入按钮（多选） |
| `tests/unit/article-portability.test.ts` | 31 例单测 |

**改动**
| 文件 | 改动 |
|---|---|
| `src/lib/download.ts` | 新增 `downloadBlob`（`downloadText` 复用它） |
| `src/components/editor/EditorWorkspace.tsx` | 工具条插入「导出」按钮 |
| `src/components/spaces/SpaceSection.tsx` | 「新建文章」旁加「导入文章」 |
| `src/components/spaces/HomeView.tsx` | 未分类区块 header 加「导入文章」 |

## 三、架构与关键决策（审查「为什么」）

1. **两级抽象**：纯层零副作用、全单测；服务层收口「建文章+素材+写正文+改写链接」「取文章+素材+打包」；路由只做 HTTP 适配。**边界纪律：纯层不得 import prisma/fs/storage。** 请核对 `article-portability.ts` 的 import 只有 `zod / adm-zip / front-matter / @/lib/validation`。
2. **素材二进制按存储位置区分**（用户决策）：`url` 是 `http(s)://` → 仅元数据；`/api/storage/<id>` → 内嵌二进制。判定点 `isCloudAssetUrl`。
3. **导出走 POST + blob**（非 GET `<a href>`）：把编辑器内存最新 markdown 作为 body，避免 5s 防抖自动保存滞后。
4. **元数据分层派生**（优于定长截取）：标题 `front-matter.title → 首条 H1 → 首行 → 兜底`；摘要 `front-matter 描述 → 正文片段`。
5. **提取的远程媒体仅建引用型 Asset**（用户决策，与「云素材仅元数据」一致，不抓取）。
6. **统一 `AssetInput`**：zip 与 md 两条路径在 `importOneArticle` 汇合，避免重复创建逻辑。

## 四、重点审查项（checklist）

### 安全（导入是外部输入，最高优先级）
- [ ] **zip-slip / 路径穿越**：`parseArticleImportZip` 的白名单 + `entryPathError`（拒绝 `..`/绝对路径/空字节）。对照范本 `src/lib/skills-manager.ts` 的 `extractSkillFromZip`。
- [ ] **炸弹 / 体积**：单条 50MB、总 200MB（`parseArticleImportZip` 内）；路由层 `MAX_IMPORT_BYTES=200MB` 原始包。
- [ ] **白名单路径**：只收 `article.md`/`article.json`/`materials.json`/`assets/<单文件>`；`assets/` 嵌套子目录被忽略；未知文件忽略不报错。
- [ ] **无 SSRF**：md 媒体提取**不发起网络请求**（确认 `extractMediaFromMarkdown` 纯字符串扫描）。
- [ ] **标题/文件名注入**：导出文件名 `safeFileSegment` 剥 `[\\/:*?"<>|]`；标题过 `TITLE_REGEX`。

### 正确性
- [ ] **链接改写**：`rewriteImageLinks` 用 `split/join` 字面量替换（URL 里的 `?()` 不被当正则元字符）；**只有内嵌二进制的本地素材**才进 `urlMap`，云素材 URL 原样保留。确认 `importOneArticle` 里 `a.binary` 分支才 `urlMap.set`。
- [ ] **引用型 Asset 的 kind**：contentType 未知时用 `a.kind || classifiedKind`（服务层引用分支）——确认 md 提取的 `kind` 不被 `classifyByContentType` 覆盖成 `file`。
- [ ] **theme/profile 回落**：`resolveThemeId`（无效→默认主题）、`resolveProfileId`（无效→null）；`status` 只保留 `ready/draft`（`pushed`→`draft`）。
- [ ] **front-matter 剥离**：`deriveArticleFromMarkdown` 存的是 `fm.body`（无 `---` 残留）；畸形 YAML 被 try/catch 兜底为整篇正文。
- [ ] **导出素材并集**：`exportArticleToZip` 取「文章关联 ∪ 正文引用的本地素材」去重——确认正文引用但未关联的本地图不会被漏导（否则导入后裂图）。
- [ ] **导出二进制降级**：`readStorageObjectBuffer` 失败 → 该素材降级为仅元数据 + 记日志，不阻断导出。

### 抽象与可维护性
- [ ] 路由是否真的「薄」：无业务逻辑、无 prisma 直连（业务全在服务层）。
- [ ] `materialsToAssetInputs` 把 zip 解析结果正确适配为 `AssetInput[]`（含 binary buffer 回填）。
- [ ] 是否过度抽象：只有「纯层 + 服务层 + 路由」三层，无多余间接层。

### 健壮性
- [ ] **单条素材失败隔离**：`importOneArticle` 内 try/catch 跳过 + 记日志，文章仍建。
- [ ] **批量失败隔离**：路由逐文件 try/catch，返回 `{results, imported, failed}`，部分失败仍 200。
- [ ] **空 MD 拒绝**：`derived.body.trim()===""` → 该文件 `ok:false`「文件内容为空」。

### UX
- [ ] 单文件成功 → 跳编辑器；多文件/有失败 → `router.refresh()` + 汇总弹窗（成功 N 篇 + 失败项原因）。
- [ ] 导出/导入按钮 `disabled` 态 + loading 文案。

## 五、刻意的设计取舍（**不是 bug，请勿误报**）

| 点 | 说明 |
|---|---|
| 无事务包裹 asset 创建 | `putBufferObject` 写本地/OSS 在 DB 事务外，导入失败可能留孤儿对象；与现有 `/api/upload` 一致，可接受。 |
| zip 内 article.md 为空时不拒绝 | zip 是导出产物，信任；空拒绝**只针对 md 路径**。 |
| 提取媒体不下载重传 | 用户明确选「仅记录引用」，保留原 URL；远程防盗链/删除会裂图（已知悉）。 |
| `.txt` 不当 md 处理 | `detectImportKind` 只认 `.md/.markdown/.mdown` + `text/markdown`；保持入口纯粹。 |
| 重复导入不去重 | 每次 `prisma.article.create` 新建，符合「搬家/备份」语义。 |
| Asset `name` 用原展示名 | 优先 `item.name`，缺失才 `genAssetName`（asset.name 无唯一约束，安全）。 |

## 六、验证步骤

```bash
pnpm typecheck
pnpm exec vitest run                 # 应 350 全绿（含 article-portability.test.ts 31 例）
pnpm exec vitest run tests/unit/article-portability.test.ts
```

手测：
1. `/editor/[id]` 点「导出」→ 解压核验 `article.md`（=屏幕正文）、`article.json`、`materials.json`、`assets/`（本地在、云不在）。
2. 首页某空间「导入文章」多选：① 带 front-matter+图片的 md ② 空 md ③ 上面的 zip → ①成功（标题/摘要/媒体引用入库、正文无 `---`）、②失败提示、③成功；首页刷新看到新文章。
3. 单选一个 md → 直接跳转编辑器，正文图片显示原远程 URL。
4. 导入到未分类区块（`spaceId=null`）。

## 七、参考实现（对照点，判断是否一致）

| 本功能 | 对照范本 |
|---|---|
| zip 解析安全 | `src/lib/skills-manager.ts` `extractSkillFromZip` |
| 素材创建（重传+建 Asset） | `src/app/api/upload/route.ts`（`putBufferObject` + `prisma.asset.create` + `genAssetName` + `classifyByContentType`） |
| 建文章 + 写正文文件 | `src/app/api/articles/route.ts` POST（`articleFilePath` + `writeContentAt`） |
| front-matter 解析 | `src/lib/convert/to-wechat.ts:53`（`import matter from "front-matter"` → `fm.body`/`fm.attributes`） |
| 摘要片段启发式 | `src/lib/content-store.ts` `previewSnippetAt`（剥 md 符号 + 折叠空白 + 截断） |
| 单文件下载 | `src/lib/download.ts` `downloadText`（`downloadBlob` 同模式） |

## 八、已知可改进项（非阻塞，供参考）

- `<source>` 标签的音视频分类靠 `type` 属性，缺省按 video（少数 audio-only 无 type 可能误分到 video）。
- `exportArticleToZip` 对每篇本地素材 `readStorageObjectBuffer` 串行读，素材很多时略慢（可并发，但注意 fd/内存）。
- 导入无进度回调（批量大文件时前端只显示「导入中…」）。
