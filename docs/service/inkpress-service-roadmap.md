# InkPress License 后续开发路线图

> 本文是 `inkpress-service` 及 InkPress 主应用 License 接入的后续开发计划，基于 [PDC](./inkpress-service-pdc.md) 契约与当前实现盘点。
>
> **当前基线**：Phase 1（认证）+ Phase 2（License 管理）+ Phase 3（客户端 License API）+ Phase 4（安全加固与运维）的**服务端部分已全部完成**并通过验收（typecheck/lint/build + Phase 3/4 端到端冒烟）。
>
> **本文档范围**：尚未落地的主应用接入、服务端补强、客户端反绕过、测试覆盖与运维增强。每项标注 PDC 章节关联、约束与验收标准，便于直接转化为开发提示词。
>
> 维护日期：2026-07-03。

---

## 0. 当前已完成的基线（勿重复实现）

| 模块 | 状态 | 关键产物 |
|---|---|---|
| 认证骨架 | ✅ Phase 1 | NextAuth（Credentials+GitHub）+ 邮箱验证码注册 + argon2id + 邀请码 + 限流 + 邮件 adapter + Docker |
| License 管理 | ✅ Phase 2 | LicenseKey/Activation/ValidationLog/AuditLog 模型；管理后台生成/禁用/撤销/解绑；用户管理；审计；邀请码归因 |
| 客户端 License API | ✅ Phase 3 | `/api/v1/licenses/{activate,validate,deactivate}`；Ed25519 `licenseToken`；AES-256-GCM `activationSecret`；HMAC + nonce 防重放；限流；全量日志 |
| 安全加固与运维 | ✅ Phase 4 | 安全响应头（CSP/HSTS/X-Frame 等）；SQLite 在线备份；日志脱敏 + mask 工具；邮件 Provider 加固；异常风控（失败信号封禁 IP） |

> 后续工作**不要改动**上述已验收的行为契约，新增功能以扩展点（新路由、新字段、客户端模块）为主。

---

## A. InkPress 主应用接入（PDC §12 —— 最大块，本期主线）

这是 Phase 3 显式 defer、且是验收标准（PDC §14.4「客户端每次启动必须校验 License，服务端判定无效时阻断核心功能」）的唯一缺口。

### A.1 License 激活页
- **目标**：用户输入 License Key，调用 `POST /api/v1/licenses/activate`，展示激活成功/失败原因（`LICENSE_INVALID` / `DEVICE_LIMIT_EXCEEDED` / `LICENSE_EXPIRED` 等）。
- **PDC**：§4.4、§12.1。
- **验收**：未激活设备首次进入应用 → 引导至激活页 → 激活成功后进入主界面。

### A.2 启动校验 `licenseGuard`
- **目标**：应用启动调用 `validate`，根据 `status`（`ACTIVE` / `EXPIRED` / `DISABLED` / `REVOKED` / `DEVICE_MISMATCH`）决定放行或跳激活页。离线时按 `offlineGraceSeconds`（72h）宽限。
- **PDC**：§4.5、§5.2、§12.2。
- **约束**：`licenseGuard` 是统一入口，核心能力调用前必经；不要在多个组件各自实现校验。
- **验收**：拔网线启动 → 72h 内可用、超期阻断；服务端撤销/禁用 → 下次校验即阻断。

### A.3 本地 License Store（安全存储）
- **目标**：用系统 Keychain（macOS Keychain / Windows Credential Manager / Linux libsecret）安全保存 `activationSecret` 与 `licenseToken`；**明文 secret 绝不落普通文件存储**。
- **PDC**：§5.1、§12.3。
- **约束**：`[[client-bundle-no-node-deps]]`——Keychain 访问在 Electron 主进程，renderer 只通过 IPC 拿明文；`[[electron-main-is-dumb-pipe]]`——主进程只做存储读写透传，业务在 Next/renderer。

### A.4 设备指纹采集
- **目标**：跨平台生成稳定 `deviceIdHash`（machineId + mac + hostname 多维哈希），上传哈希、**不上传明文 MAC**。
- **PDC**：§12.5。
- **约束**：指纹需稳定（重装系统/重启不变）且唯一性足够；遵从隐私（不收集可还原信息）。

### A.5 设置页 License 状态
- **目标**：展示有效期、已用/最大设备数、上次校验时间、License 后缀；提供「手动刷新」（再 `validate`）与「释放本机」（`deactivate`）。
- **PDC**：§12.6。

### A.6 核心阻断点接入
- **目标**：4 个 gate 接入 `licenseGuard`：① 写作工作区入口；② AI 生成接口；③ 文章导出/发布；④ 自动化/Agent 长任务启动。
- **PDC**：§12「核心阻断点」。
- **验收**：未通过校验时这 4 类操作被阻断并提示，而非静默放行。

---

## B. 服务端补强（小而具体，可与 A 并行）

### B.1 批量生成 License
- **现状**：`batchNo` 字段 + 列表筛选已就位，但 `createLicense` 是单个。
- **目标**：admin 创建时支持 `count`（一次建 N 个，共享 `batchNo`），明文 Key 列表一次性返回并支持导出。
- **PDC**：§6.5（`batchNo`）、§7.2。

### B.2 GitHub 强制 verified email（§16 开放问题 #2）
- **现状**：`auth.ts` 的 GitHub signin **未校验 `emailVerified`**——真实缺口。
- **目标**：GitHub 账号 email 未 verified 时拒绝登录/注册，与邮箱验证码注册的安全语义对齐。
- **PDC**：§16 #2（推荐必须）。

### B.3 License 续期 / 延期
- **现状**：`effectiveExpiresAt` 首激活后固定，到期无延期路径。
- **目标**：admin 可延长有效期（改 `durationDays` / 重算 `effectiveExpiresAt`），写 AuditLog。
- **PDC**：§6.5、§7.2。

### B.4 `metadataJson` 启用
- **现状**：`LicenseActivation.metadataJson` 字段闲置（默认 `"{}"`）。
- **目标**：用于渠道/版本灰度/特性开关；`validate` 时下发给客户端做特性门控。
- **PDC**：§6.6。

### B.5 多实例 Redis 化限流 / 风控
- **现状**：单实例内存存储（`rate-limit/index.ts`、`risk/anomaly.ts`）。
- **目标**：底层迁 Redis，接口保持不变（`checkRateLimits` / `isIpBlocked` / `recordSignal`）。
- **PDC**：§9.3 注。
- **触发时机**：规模化、多实例部署时再做。

---

## C. 客户端反绕过（PDC §5.4 —— Electron 侧）

> 依赖 A 跑通后做，属于"提高绕过成本"的加固层。

### C.1 打包加固
- asar 封装 + 代码混淆/压缩 + 应用签名 + 完整性校验。
- **PDC**：§5.4、§9「打包时开启 asar、代码压缩、签名和完整性校验」。

### C.2 本地异常上报
- 检测本地 token 篡改 / 设备 ID 变化 / 时间回拨 → 上报服务端 + 本地告警。
- **PDC**：§5.4「日志中记录异常状态切换」。

### C.3 多点校验
- 不只启动校验，核心操作前复验 token（与 A.6 阻断点配合）。

---

## D. 测试覆盖（PDC §14）

### D.1 单元测试（引入 vitest）
目前只有 smoke 脚本（`scripts/smoke/*.mjs`），无正式单测。按 §14.1 覆盖：
- License Key 生成、哈希、fingerprint、唯一性
- 有效期计算：1/3/5 年、自定义年份、自定义天数、永久（`computeEffectiveExpiresAt`）
- 激活幂等：同 key 同设备重复激活不增加设备数
- 设备数限制：达上限后 `DEVICE_LIMIT_EXCEEDED`
- 过期/禁用/撤销状态校验
- 签名校验、nonce 重放、timestamp 过期

**目标模块**：`license/key.ts`、`license/token.ts`、`license/activation-secret.ts`、`license/request-signature.ts`。

### D.2 集成 / E2E（§14.2 / §14.3）
- 注册→登录→查看邀请码
- admin 生成 License → 普通用户无法访问管理 API
- 激活后 `validate` 成功、撤销后失败
- 客户端模拟激活、重启校验、过期阻断（A 完成后）

---

## E. 运维与可观测

- **邮件 DKIM/SPF**：域名侧 DNS 配置（非代码）。
- **License 用量 / 风控看板**：基于 `LicenseValidationLog` 统计激活率、失败 IP、设备增长。
- **密钥轮换流程文档**：`LICENSE_KEY_PEPPER` / `ACTIVATION_SECRET_KEK` / Ed25519 keypair 的轮换步骤（轮换需重发 key / 重激活）。

---

## §16 开放决策（需产品拍板，影响实现）

| # | 决策 | 现状 | 建议 |
|---|---|---|---|
| 1 | 用户自助**跨设备**释放 vs 仅本机 + 管理员 | 本机 `deactivate` + admin `revoke` | 维持现状（跨机释放风险高） |
| 2 | GitHub 必须 verified email | **未强制** | 改为强制（→ B.2） |
| 3 | 离线宽限期 | 72h | ✅ 已按推荐 |
| 4 | 邀请码归因时机 | 仅 License 创建时绑定 | ✅ 已按推荐 |
| 5 | admin 初始化后关闭 seed 重复执行 | 无管理员才生效（幂等） | ✅ 已实现 |

---

## 推荐落地顺序

```
①  §16 #2 / B.2  GitHub 强制 verified       ──► 最小改动、堵真实漏洞（半天）
②  B.1 批量生成 + B.3 续期                  ──► 管理端运营刚需（1–2 天）
③  A   主应用接入（§12 六项，A.1→A.6 增量）  ──► 最大块、真正交付价值
④  D.1 vitest 单测覆盖                      ──► 随 A 一起补，锁定行为契约
⑤  C   客户端反绕过                         ──► A 跑通后做加固（依赖打包流程）
⑥  B.5 Redis 化 / E 看板                    ──► 规模化时再做
```

---

## 协作约定（写开发提示词时）

本项目已有 PDC 契约 + 自动 memory + graphify 三重上下文，后续提示词遵循「**层 + PDC 章节 + 做/defer 范围 + 验证**」四要素，无需复述背景。关键约束（已沉淀于 memory，提示词中点明更稳）：

- `[[no-auto-commit]]`：只在明确要求时 commit，并说清范围。
- `[[client-bundle-no-node-deps]]`：`"use client"` / renderer import 链禁止拉 prisma/better-sqlite3；共享注册表拆 meta（客户端）/ finalize（服务端）。
- `[[electron-main-is-dumb-pipe]]`：主进程零业务、零 `@/lib` import，只做 IPC 透传。
- `[[llm-first-regex-fallback]]`：解析/路由类新模块用 LLM 主判 + 声明式 registry 兜底。
- `[[declarative-registry-over-hardcode]]`：新增 if/else 分发分支抽成 registry + 数据驱动。

代码库问题先 `graphify query`；改完代码 `graphify update .`。
