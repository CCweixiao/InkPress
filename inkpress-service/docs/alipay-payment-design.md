# InkPress 支付宝当面付接入技术设计

> 本文是 InkPress 接入支付宝「当面付」的完整实现方案。
>
> - **仅支持支付宝当面付**（个人实名认证即可开通，无需营业执照）
> - 用户在 PC 端扫码支付，资金实时进入个人支付宝余额
> - 支付成功后自动发放 License Key
>
> 相关文档：`release-overview.md`（发布流程）、`wechat-scan-login-design.md`（微信登录）。

---

## 0. 设计目标与非目标

### 目标
1. 用户在 InkPress 选择套餐 → 扫支付宝二维码 → 自动发放 License Key
2. 个人开发者可开通（无营业执照门槛）
3. 复用现有 License 生成逻辑（`lib/license/admin-service.ts` → `createLicense`）
4. 资金直接进个人支付宝余额，实时到账

### 非目标（本轮不做）
- 微信支付 / 其他支付渠道
- 退款自动化（仅管理员手动退款，见 §11.3）
- 订阅 / 周期扣款（当前只做一次性买断）
- 发票自动开具（后续接电子发票服务）

---

## 1. 前置条件与开通流程

### 1.1 开通步骤（支付宝开放平台）

| 步骤 | 操作 | 产出 |
|---|---|---|
| ① 实名认证 | 用个人支付宝账号登录 [open.alipay.com](https://open.alipay.com)，完成实名认证 | 实名账号 |
| ② 创建应用 | 控制台 → 创建「网页/移动应用」 | `APPID` |
| ③ 签约当面付 | 应用 → 能力列表 → 添加「当面付」→ 提交签约 | 审批 1-3 天 |
| ④ 配置密钥 | 下载 [支付宝开放平台密钥工具](https://opendoc.alipay.com/common/02kipl)，生成 RSA2 密钥对（2048 位） | `应用私钥` + `应用公钥` |
| ⑤ 上传公钥 | 应用 → 开发设置 → 接口加签方式 → 上传应用公钥 | 平台返回 `支付宝公钥` |
| ⑥ 设置网关 | 开发设置 → 网关地址 → 选 `https://openapi.alipay.com/gateway.do`（生产） | — |
| ⑦ 沙箱联调 | 控制台 → 沙箱 → 用沙箱 APPID / 密钥联调 | 全流程跑通 |

### 1.2 得到的凭证清单

| 变量 | 来源 | 备注 |
|---|---|---|
| `ALIPAY_APP_ID` | 步骤 ② | 应用 APPID |
| `ALIPAY_APP_PRIVATE_KEY` | 步骤 ④ | 应用私钥（**绝对保密**） |
| `ALIPAY_PUBLIC_KEY` | 步骤 ⑤ | 支付宝公钥（用于验签回调） |
| `ALIPAY_GATEWAY` | 步骤 ⑥ | 生产 `openapi.alipay.com/gateway.do`；沙箱 `openapi-sandbox.dl.alipaydev.com/gateway.do` |
| `ALIPAY_SIGN_TYPE` | 固定 `RSA2` | — |
| `ALIPAY_NOTIFY_URL` | 自填 | `https://<你的域名>/api/payments/alipay/notify` |

### 1.3 沙箱说明
- 沙箱环境免费、无需审批即可用
- 沙箱买家账号 + 沙箱卖家账号由平台提供（控制台 → 沙箱 → 沙箱账号）
- 沙箱密钥与生产密钥**完全独立**，上线时需替换

---

## 2. 端到端架构与数据流

### 2.1 整体流程

```
┌─────────────── 用户浏览器（收银台） ───────────────────────────┐
│                                                                  │
│  1. 选择套餐 → POST /api/orders { planSlug }                    │
│  2. 服务端创建 Order(PENDING) + 调 precreate → 返回 qr_code     │
│  3. 展示二维码，开始每 2s 轮询 GET /api/orders/[id]             │
│  4. 用户打开支付宝 App 扫码 → 输入密码 → 支付成功              │
│                                                                  │
└──────────────────────────┬──────────────────────────────────────┘
                           │
              ┌────────────┴────────────┐
              ▼                         ▼
┌──── 支付宝异步回调 ────┐    ┌──── 前端轮询（兜底） ────┐
│ POST /notify           │    │ GET /api/orders/[id]    │
│ 验签 → 幂等检查        │    │ 查 DB 订单状态          │
│ → 更新 Order(PAID)     │    │ PAID → 前端跳转成功页   │
│ → 事务内发放 License   │    └─────────────────────────┘
│ → 返回 "success"       │
└────────────────────────┘
```

### 2.2 关键设计决策

| 决策 | 方案 | 理由 |
|---|---|---|
| 二维码方案 | `alipay.trade.precreate` | 当面付核心 API，返回 `qr_code` 字符串，前端用 `qrcode` 库渲染 |
| 支付完成感知 | **异步回调为主 + 前端轮询兜底** | 回调最可靠；轮询防止回调延迟/丢失 |
| 轮询间隔 | 2 秒 | 平衡实时性与服务器压力 |
| 订单超时 | 15 分钟 | `timeout_express: '15m'`，超时后支付宝自动关单 |
| 金额单位 | **分（整数）** 全链路 | 避免浮点累计误差；调支付宝 API 时才 `÷100` 转成元（2 位小数字符串） |
| License 发放 | 支付成功**同事务**内发放 | 防止「订单已付但没发 License」的数据不一致 |

---

## 3. 数据模型

### 3.1 Order 订单

```prisma
model Order {
  id            String    @id @default(cuid())
  userId        String    // 下单用户（必须已登录）
  outTradeNo    String    @unique // InkPress 内部订单号，传给支付宝（≤32 字符）
  planSlug      String    // 套餐 slug（见 §4，下单时快照）
  planName      String    // 套餐名快照（下单时固化，便于历史展示）
  planConfigJson String   @default("{}") // License 生成参数快照（durationKind/maxDevices/...）
  subject       String    // 商品标题（如「InkPress 年度版 · 3 设备」）
  amountCents   Int       // 实付金额（分），下单时从 Plan 快照
  status        String    @default("PENDING") // PENDING | PAID | CLOSED | REFUNDED
  tradeNo       String?   // 支付宝流水号（回调写入）
  buyerLogonId  String?   // 买家支付宝账号（回调写入，便于排障）
  licenseKeyId  String?   // 支付成功后生成的 License Key ID
  paidAt        DateTime?
  closedAt      DateTime?
  notifyCount   Int       @default(0) // 回调到达次数（幂等排障用）
  lastNotifyAt  DateTime?
  createdIp     String?
  createdUa     String?
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt

  user          User      @relation(fields: [userId], references: [id])

  @@index([userId, status])
  @@index([status, createdAt])
  @@index([outTradeNo])
}
```

> **快照策略**：`planSlug` / `planName` / `planConfigJson` / `amountCents` 在下单时即固化，与 Plan 当前配置解耦。后续套餐调价、改配置均不影响历史订单的收款与发券。

需要在 `User` model 增加反向关系：
```prisma
model User {
  // ...existing fields...
  orders        Order[]
}
```

### 3.2 字段状态机

```
PENDING ──支付成功──→ PAID ──管理员退款──→ REFUNDED
   │
   └──超时/关单──→ CLOSED
```

- **PENDING**：已创建，待支付
- **PAID**：回调确认收款，License 已发放
- **CLOSED**：超时未支付（支付宝自动关单或本地 cron 清理）
- **REFUNDED**：管理员手动退款（License 同步标记 REVOKED）

### 3.3 outTradeNo 生成规则

```
INKP + YYYYMMDDHHmmss + 6位随机
例：INKP20260704143022A1B2C3
总长 26 字符（< 32 上限）
```

```typescript
function generateOutTradeNo(): string {
  const ts = format(new Date(), "yyyyMMddHHmmss");
  const rand = randomBytes(3).toString("hex").toUpperCase(); // 6 位
  return `INKP${ts}${rand}`;
}
```

DB `@unique` 约束兜底冲突，创建时 catch unique 错误重试一次。

---

## 4. 订阅计划（Plan，DB 模型）

### 4.1 设计思路

套餐用 DB 模型管理（非硬编码），管理员可在后台增删改套餐，无需发版。

> 已有的 zod 校验（`src/lib/validation/schemas.ts` 中 `createPlanSchema` / `updatePlanSchema`）直接复用。

### 4.2 Plan 数据模型（Prisma）

```prisma
model Plan {
  id                  String   @id @default(cuid())
  slug                String   @unique // URL 标识，如 "year1_3dev"
  name                String   // 展示名，如 "年度版 · 3 设备"
  tagline             String?  // 副标题
  durationKind        String   // YEAR_1 | YEAR_3 | YEAR_5 | PERMANENT
  durationYears       Int?
  maxDevices          Int
  priceCents          Int      // 原价（分）
  discountPriceCents  Int?     // 折扣价（分），null = 无折扣
  featuresJson        String   @default("[]") // 特性列表 JSON 数组
  highlight           String?  // popular | best_value | null
  sortOrder           Int      @default(0) // 排序（小→大）
  status              String   @default("ACTIVE") // ACTIVE | INACTIVE
  createdAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt

  orders              Order[]

  @@index([status, sortOrder])
}
```

### 4.3 管理后台 CRUD（复用现有 Plan schemas）

| 端点 | 作用 | 校验 |
|---|---|---|
| `GET /api/admin/plans` | 列表（含 INACTIVE） | — |
| `POST /api/admin/plans` | 创建 | `createPlanSchema` |
| `PATCH /api/admin/plans/[id]` | 更新 | `updatePlanSchema` |
| `DELETE /api/admin/plans/[id]` | 软删除（标 INACTIVE） | — |

公开查询端点（套餐选择页用）：
```
GET /api/plans → 返回 status=ACTIVE 的 Plan 列表（按 sortOrder 排序）
```

### 4.4 Plan → createLicense 入参映射

```typescript
function planToLicenseInput(plan: Plan, ownerEmail: string): CreateLicenseInput {
  return {
    durationKind: plan.durationKind,
    durationYears: plan.durationYears ?? undefined,
    maxDevices: plan.maxDevices,
    ownerEmail,
    note: "在线购买自动发放",
    batchNo: null,
  };
}
```

> ⚠️ `createLicense` 要求 `createdByUserId`。支付发券场景用一个固定的系统账号 ID（初始化一个 `email = system@inkpress.local` 的 ADMIN 用户专门做「自动发券操作人」），审计日志 actor 清晰。

### 4.5 价格快照（关键设计）

**Order 创建时即固化 `amountCents`**，与 Plan 当前价格解耦：

```typescript
// 创建订单时
const plan = await getActivePlan(slug);
const amountCents = plan.discountPriceCents ?? plan.priceCents;
await prisma.order.create({
  data: { ..., amountCents, planSlug: plan.slug },
});
```

后续 Plan 调价只影响新订单，老订单仍按原价收款。回调时校验的是订单固化的 `amountCents`，与 Plan 无关。

---

## 5. API 设计

### 5.1 创建订单 + 获取二维码

```
POST /api/orders
Auth: session required
Body: { "planSlug": "year1_3dev" }
Response 200: {
  "ok": true,
  "data": {
    "orderId": "ckabc...",
    "outTradeNo": "INKP20260704...",
    "qrCode": "https://qr.alipay.com/bax0000000000",  // precreate 返回
    "amountCents": 12900,
    "subject": "InkPress 年度版 · 3 设备",
    "expiresAt": "2026-07-04T14:45:22.000Z"  // 15 分钟后
  }
}
```

服务端流程：
1. 校验 session + planSlug 有效（查 ACTIVE Plan）
2. 限流：每用户每分钟 5 个订单
3. 生成 `outTradeNo`（重试防碰撞）
4. 创建 Order(PENDING) 记录（快照 Plan 配置）
5. 调用 `alipay.trade.precreate`
6. 把二维码链接 `qr_code` 写入响应（不入库，precreate 每次都生成新码）

错误码：
- `UNAUTHORIZED`：未登录
- `VALIDATION_ERROR`：planSlug 不存在或 Plan INACTIVE
- `RATE_LIMITED`：创建过频
- `PAYMENT_PROVIDER_ERROR`：支付宝 precreate 调用失败

### 5.2 查询订单状态（前端轮询）

```
GET /api/orders/[id]
Auth: session + 订单归属校验
Response 200: {
  "ok": true,
  "data": {
    "orderId": "ckabc...",
    "status": "PAID",         // PENDING | PAID | CLOSED
    "amountCents": 12900,
    "subject": "...",
    "licenseKeyId": "ckxyz...",  // PAID 时有值
    "paidAt": "2026-07-04T14:33:01.000Z"
  }
}
```

归属校验：`order.userId === session.user.id`，否则 `FORBIDDEN`。

### 5.3 支付宝异步回调

```
POST /api/payments/alipay/notify
Auth: 无（公开端点，靠验签防伪）
Content-Type: application/x-www-form-urlencoded
Body: 支付宝标准回调表单（含 sign、sign_type、trade_status、out_trade_no、trade_no、total_amount、buyer_logon_id 等）

Response:
  - 验签通过且处理成功 → 返回纯文本 "success"（HTTP 200）
  - 验签失败或处理异常 → 返回纯文本 "fail"（HTTP 200）
```

> 支付宝约定：收到 `success` 后停止重试；收到 `fail` 或非 200 会重试最多 8 次（间隔递增，最长 24 小时）。因此处理逻辑**必须幂等**。

### 5.4 我的订单列表

```
GET /api/me/orders?page=1&pageSize=20
Auth: session
Response 200: { ok: true, data: { items: [...], total, page, pageSize } }
```

---

## 6. 支付宝 SDK 封装

### 6.1 依赖

```bash
pnpm add alipay-sdk
```

官方 Node.js SDK：[alipay-sdk 文档](https://opendoc.alipay.com/open/02kipl)

### 6.2 单例初始化

```typescript
// src/lib/payment/alipay/client.ts
import AlipaySdk from "alipay-sdk";

let cached: AlipaySdk | null = null;

export function getAlipayClient(): AlipaySdk {
  if (cached) return cached;
  cached = new AlipaySdk({
    appId: process.env.ALIPAY_APP_ID!,
    privateKey: process.env.ALIPAY_APP_PRIVATE_KEY!.replace(/\\n/g, "\n"),
    alipayPublicKey: process.env.ALIPAY_PUBLIC_KEY!.replace(/\\n/g, "\n"),
    signType: "RSA2",
    gateway: process.env.ALIPAY_GATEWAY ?? "https://openapi.alipay.com/gateway.do",
  });
  return cached;
}
```

> 私钥/公钥含换行符时，在 `.env` 里通常以 `\n` 转义存储，运行时 `.replace(/\\n/g, "\n")` 还原。

### 6.3 precreate 封装

```typescript
// src/lib/payment/alipay/api.ts
import { getAlipayClient } from "./client";

export interface PrecreateResult {
  qrCode: string; // 二维码链接（前端渲染成图片）
}

export async function precreateOrder(opts: {
  outTradeNo: string;
  totalAmount: number; // 元，2 位小数
  subject: string;
  notifyUrl: string;
}): Promise<PrecreateResult> {
  const client = getAlipayClient();
  const result = await client.exec("alipay.trade.precreate", {
    bizContent: {
      out_trade_no: opts.outTradeNo,
      total_amount: opts.totalAmount.toFixed(2),
      subject: opts.subject,
      timeout_express: "15m",
    },
  }, {
    // SDK v4 写法：notify_url 通过 options 传入
    notify_url: opts.notifyUrl,
  });
  // result.qrCode 或 result.qr_code（SDK 版本差异）
  const qrCode = result.qrCode ?? result.qr_code;
  if (!qrCode) throw new AppError(ErrorCode.PAYMENT_PROVIDER_ERROR, "支付宝未返回二维码");
  return { qrCode };
}
```

### 6.4 验签封装

```typescript
// src/lib/payment/alipay/verify.ts
import { getAlipayClient } from "./client";

/**
 * 验证支付宝异步通知签名。
 * @param params 表单参数对象（sign/sign_type 之外的所有字段）
 */
export function verifyNotifySign(params: Record<string, string>): boolean {
  const client = getAlipayClient();
  return client.checkNotifySign(params);
}
```

---

## 7. 回调处理（核心安全环节）

### 7.1 完整处理流程

```typescript
// POST /api/payments/alipay/notify
export async function POST(req: NextRequest) {
  // 1. 解析表单（支付宝用 x-www-form-urlencoded）
  const formData = await req.formData();
  const params: Record<string, string> = {};
  for (const [k, v] of formData.entries()) {
    params[k] = String(v);
  }

  // 2. 验签（防伪造）
  if (!verifyNotifySign(params)) {
    log.warn({ outTradeNo: params.out_trade_no }, "支付宝回调验签失败");
    return new Response("fail", { status: 200 });
  }

  // 3. 只处理最终成功状态
  const tradeStatus = params.trade_status;
  if (tradeStatus !== "TRADE_SUCCESS" && tradeStatus !== "TRADE_FINISHED") {
    // WAIT_BUYER_PAY / TRADE_CLOSED 等状态直接 ack
    return new Response("success", { status: 200 });
  }

  const outTradeNo = params.out_trade_no;
  const tradeNo = params.trade_no;
  const totalAmount = params.total_amount; // 元字符串 "129.00"
  const buyerLogonId = params.buyer_logon_id;

  try {
    // 4. 幂等 + 金额校验 + License 发放（事务）
    await fulfillOrderIfPending({
      outTradeNo,
      tradeNo,
      totalAmountYuan: totalAmount,
      buyerLogonId,
    });
    return new Response("success", { status: 200 });
  } catch (err) {
    log.error({ outTradeNo, err }, "回调处理失败");
    return new Response("fail", { status: 200 }); // 支付宝会重试
  }
}
```

### 7.2 fulfillOrderIfPending（事务）

```typescript
async function fulfillOrderIfPending(opts: {
  outTradeNo: string;
  tradeNo: string;
  totalAmountYuan: string;
  buyerLogonId?: string;
}): Promise<void> {
  await prisma.$transaction(async (tx) => {
    // 加锁查询（SQLite 用事务即可）
    const order = await tx.order.findUnique({
      where: { outTradeNo: opts.outTradeNo },
      select: { id: true, userId: true, status: true, amountCents: true, planSlug: true, planConfigJson: true },
    });

    if (!order) {
      // 订单不存在，可能是伪造（虽已验签）。返回 success 避免重试，但记录警告
      log.warn({ outTradeNo: opts.outTradeNo }, "回调订单不存在");
      return;
    }

    // 已处理 → 幂等返回
    if (order.status === "PAID") {
      log.info({ orderId: order.id }, "订单已处理，幂等跳过");
      return;
    }

    if (order.status === "CLOSED" || order.status === "REFUNDED") {
      log.warn({ orderId: order.id, status: order.status }, "订单状态异常，跳过");
      return;
    }

    // 金额校验（关键安全点）
    const expectedYuan = (order.amountCents / 100).toFixed(2);
    if (opts.totalAmountYuan !== expectedYuan) {
      log.error(
        { orderId: order.id, expected: expectedYuan, got: opts.totalAmountYuan },
        "回调金额不匹配"
      );
      throw new Error("金额不匹配");
    }

    // 查用户邮箱（License ownerEmail）
    const user = await tx.user.findUnique({
      where: { id: order.userId },
      select: { email: true },
    });
    if (!user) throw new Error("用户不存在");

    // 从订单快照恢复 License 生成参数（与 Plan 当前配置解耦）
    const cfg = JSON.parse(order.planConfigJson) as {
      durationKind: string;
      durationYears?: number;
      maxDevices: number;
    };

    const licenseKey = await tx.licenseKey.create({
      data: {
        // ...与 admin-service createLicense 相同的字段
        // durationKind/durationYears/maxDevices 来自 cfg 快照
        // createdByUserId 用系统账号
      },
    });

    // 更新订单
    await tx.order.update({
      where: { id: order.id },
      data: {
        status: "PAID",
        tradeNo: opts.tradeNo,
        buyerLogonId: opts.buyerLogonId ?? null,
        licenseKeyId: licenseKey.id,
        paidAt: new Date(),
        notifyCount: { increment: 1 },
        lastNotifyAt: new Date(),
      },
    });

    // 审计日志
    await tx.auditLog.create({
      data: {
        actorUserId: order.userId,
        actorRole: "USER",
        action: "order.paid",
        targetType: "Order",
        targetId: order.id,
        detailsJson: JSON.stringify({
          channel: "ALIPAY",
          tradeNo: opts.tradeNo,
          licenseKeyId: licenseKey.id,
          amountCents: order.amountCents,
        }),
      },
    });

    log.info({ orderId: order.id, licenseKeyId: licenseKey.id }, "订单支付成功，License 已发放");
  });
}
```

---

## 8. 收银台前端

### 8.1 页面路由

```
/pricing         → 套餐选择页（公开，展示所有 ACTIVE Plan + 价格）
/checkout?plan=year1_3dev → 收银台（需登录）
```

### 8.2 收银台组件结构

```tsx
// src/app/checkout/page.tsx（Server Component）
export default async function CheckoutPage({ searchParams }) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login?callbackUrl=/checkout?plan=...");

  const plan = await getActivePlan(searchParams.plan);
  if (!plan) notFound();

  return <CheckoutClient plan={plan} userEmail={session.user.email!} />;
}
```

```tsx
// src/components/payment/checkout-client.tsx（Client Component）
function CheckoutClient({ plan, userEmail }) {
  const [order, setOrder] = useState<OrderInfo | null>(null);
  const [status, setStatus] = useState<"loading" | "pending" | "paid" | "error">("loading");
  const [error, setError] = useState<string | null>(null);

  // 1. 进入即创建订单
  useEffect(() => {
    createOrder(plan.slug).then(({ data, error }) => {
      if (error) { setError(error); setStatus("error"); return; }
      setOrder(data);
      setStatus("pending");
    });
  }, [plan.slug]);

  // 2. 轮询订单状态（2s 间隔）
  useEffect(() => {
    if (status !== "pending" || !order) return;
    const timer = setInterval(async () => {
      const res = await pollOrder(order.orderId);
      if (res.status === "PAID") {
        setStatus("paid");
        clearInterval(timer);
        // 3. 跳转成功页
        router.push(`/checkout/success?orderId=${order.orderId}`);
      }
    }, 2000);
    return () => clearInterval(timer);
  }, [status, order]);

  // 超时定时器（15 分钟）
  useEffect(() => {
    const timeout = setTimeout(() => {
      if (status === "pending") setStatus("error"), setError("支付超时，请重新下单");
    }, 15 * 60 * 1000);
    return () => clearTimeout(timeout);
  }, []);

  return (
    <Card>
      {/* 二维码 + 金额 + 套餐信息 + 状态提示 */}
      {order && <QRCode value={order.qrCode} size={240} />}
      <Button onClick={() => router.push(`/checkout/success?orderId=${order.orderId}`)}>我已支付</Button>
    </Card>
  );
}
```

### 8.3 二维码渲染库

```bash
pnpm add qrcode.react
```

```tsx
import { QRCodeSVG } from "qrcode.react";
<QRCodeSVG value={qrCode} size={240} includeMargin />
```

### 8.4 支付成功页

```
/checkout/success?orderId=xxx
```

展示：
- ✅ 支付成功
- License Key（调用 `/api/me/owned-licenses/[id]/reveal-key` 展示明文，或只显示指纹引导去 Dashboard 查看）
- 「前往 Dashboard」按钮

---

## 9. 安全设计

### 9.1 验签（最重要）

| 场景 | 措施 |
|---|---|
| 回调伪造 | `verifyNotifySign()` 必须先调，失败即返回 `fail` |
| 回调重放 | 已 `PAID` 的订单幂等返回 `success`，不重复发放 |
| 回调金额篡改 | DB `amountCents` 与回调 `total_amount` 比对，不一致抛错并告警 |

### 9.2 订单防滥用

| 维度 | 规则 |
|---|---|
| 创建订单限流 | 每用户每分钟 5 单、每小时 30 单 |
| 未支付订单堆积 | 每用户最多 10 个 PENDING 订单（防止灌库） |
| 同 SKU 重复下单 | 允许（用户可能买多份送人） |

### 9.3 凭证安全

| 凭证 | 存储 |
|---|---|
| `ALIPAY_APP_PRIVATE_KEY` | 仅 `.env.production`（服务器），**不进 git** |
| `ALIPAY_PUBLIC_KEY` | 可进 git（公钥无保密性），但建议仍放 `.env` 统一管理 |
| `.env*` | `.gitignore` + `.dockerignore` + rsync `--exclude`（已有三层防护） |

### 9.4 时序与并发

- `fulfillOrderIfPending` 必须在**数据库事务**内完成「校验 + 改状态 + 发券」
- SQLite 默认串行写入，天然防并发；若未来迁 PostgreSQL 需加 `SELECT ... FOR UPDATE`
- 回调可能重试 8 次，事务保证幂等

### 9.5 日志与审计

- `order.create` / `order.paid` / `order.refund` 写 `AuditLog`
- 回调验签失败、金额不匹配、订单不存在 → `WARN`/`ERROR` 日志，便于排障
- 回调原文（脱敏后）可考虑落 `PaymentNotifyLog` 表（可选，便于对账）

---

## 10. 配置

### 10.1 环境变量

```env
# .env.example 新增
# ===== 支付宝当面付 =====
# 开通流程见 docs/alipay-payment-design.md §1
ALIPAY_APP_ID=""
ALIPAY_APP_PRIVATE_KEY=""
ALIPAY_PUBLIC_KEY=""
ALIPAY_GATEWAY="https://openapi.alipay.com/gateway.do"
# 沙箱设为 https://openapi-sandbox.dl.alipaydev.com/gateway.do
# 回调地址（必须是公网可达的 HTTPS 地址）
ALIPAY_NOTIFY_URL="https://www.longoflow.com/api/payments/alipay/notify"
# 系统发券操作人（init-admin 创建的 system 账号 ID）
PAYMENT_SYSTEM_USER_ID=""
```

### 10.2 支付宝后台配置项

| 配置项 | 值 |
|---|---|
| 应用网关 | `https://www.longoflow.com` |
| 授权回调地址 | 暂不需要（当面付不依赖 OAuth） |
| 异步通知 URL | 在 `precreate` 请求里通过 `notify_url` 参数指定（不在后台固定配置） |

### 10.3 init-admin 系统账号

```bash
# 初始化一个系统发券账号（仅用于自动发券的 createdByUserId）
ADMIN_EMAIL="system@inkpress.local" \
ADMIN_PASSWORD="<random-strong>" \
pnpm init-admin
```

把得到的用户 ID 填入 `PAYMENT_SYSTEM_USER_ID`。此账号 `role=ADMIN` 但不用于人类登录，仅作审计 actor。

---

## 11. 管理后台

### 11.1 订单列表页

```
/admin/orders?page=1&status=PAID
```

展示：
- 订单号、用户、套餐、金额、状态、创建/支付时间、License 关联
- 筛选：状态、时间范围
- 搜索：outTradeNo / tradeNo / 用户邮箱

### 11.2 订单详情页

```
/admin/orders/[id]
```

展示完整信息 + 回调记录 + License 详情链接。

### 11.3 手动操作

| 操作 | 触发条件 | 行为 |
|---|---|---|
| 手动标记已付 | 回调丢失、需对账 | 调 `alipay.trade.query` 确认后再补发 License（二次确认防伪造） |
| 手动退款 | 用户申请退款 | 调 `alipay.trade.refund` → License 标记 `REVOKED` → 订单 `REFUNDED` |
| 关闭订单 | 用户不要了 | 本地标 `CLOSED`（不影响支付宝侧） |

> 手动操作必须写审计日志（`actorRole=ADMIN`）。

---

## 12. 异常场景

### 12.1 回调丢失怎么办
- **前端轮询兜底**：用户浏览器在收银台会轮询订单状态
- **定时对账**（可选）：每小时 cron 查 `PENDING` 超过 15 分钟的订单 → 调 `alipay.trade.query` 主动查询 → 若已付则补发 License
- **管理员手动**：后台订单详情页「主动查询」按钮

### 12.2 用户支付了但二维码已超时
- 支付宝侧 `timeout_express=15m`，超时后用户无法支付
- 若用户已扫码但未在 15 分钟内完成，支付宝会自动关单
- 用户需重新下单生成新二维码

### 12.3 License 发放失败（DB 写入异常）
- 事务会回滚，订单仍是 `PENDING`
- 支付宝回调收到 `fail` → 重试
- 若一直失败（如 DB 故障），通过定时对账兜底

### 12.4 金额不一致
- 回调 `total_amount` ≠ 订单 `amountCents/100`
- 拒绝处理，返回 `fail`，记录 `ERROR` 日志
- 管理员介入排查（通常是 SKU 价格变更但旧订单未更新）

### 12.5 重复回调
- 幂等：已 `PAID` 的订单收到回调直接返回 `success`，不重复发券
- `notifyCount` 字段记录次数，便于排查

---

## 13. 实施步骤（分 PR）

### PR 1：数据模型 + Plan 基础设施
- [ ] Prisma 新增 `Order` + `Plan` model + User 反向关系
- [ ] 新增 `prisma/migrations/xxx_order_plan`
- [ ] 新增 `src/lib/payment/plan-service.ts`（Plan CRUD + getActivePlan）
- [ ] `GET /api/plans`（公开）+ `GET/POST/PATCH/DELETE /api/admin/plans`
- [ ] 新增 `src/lib/payment/alipay/client.ts`（SDK 单例）
- [ ] 安装 `alipay-sdk` 依赖
- [ ] `.env.example` 新增支付宝变量
- [ ] init 系统发券账号脚本

### PR 2：下单 + 回调核心链路
- [ ] `POST /api/orders`（创建订单 + precreate）
- [ ] `GET /api/orders/[id]`（轮询）
- [ ] `POST /api/payments/alipay/notify`（验签 + 事务发券）
- [ ] `src/lib/payment/alipay/api.ts`（precreate 封装）
- [ ] `src/lib/payment/alipay/verify.ts`（验签封装）
- [ ] 沙箱联调全流程

### PR 3：收银台前端
- [ ] `/pricing` 套餐选择页
- [ ] `/checkout?sku=xxx` 收银台（二维码 + 轮询）
- [ ] `/checkout/success` 成功页
- [ ] `qrcode.react` 依赖
- [ ] Dashboard 新增「购买 License」入口

### PR 4：管理后台
- [ ] `GET /api/admin/orders`（列表）
- [ ] `/admin/orders` 页面
- [ ] `/admin/orders/[id]` 详情页
- [ ] 手动查询支付宝状态按钮
- [ ] 审计日志写入

### PR 5（可选）：定时对账
- [ ] cron 查 PENDING 超时订单 → 调 `alipay.trade.query` 兜底
- [ ] 超时订单自动标记 CLOSED

---

## 14. 验证清单（上线前自检）

```bash
# 1. 沙箱全流程联调
#    创建订单 → 扫沙箱二维码 → 沙箱买家付款 → 回调到达 → License 发放 → 前端跳转成功页

# 2. 生产环境验证（小额测试）
#    用 ¥0.01 套餐（临时加一个测试 SKU）走完整流程

# 3. 验签测试
#    手动构造伪造回调 POST → 确认返回 "fail"

# 4. 幂等测试
#    同一订单回调两次 → 确认只发一份 License

# 5. 金额校验测试
#    篡改回调 total_amount → 确认拒绝处理

# 6. 超时测试
#    下单后不支付 → 15 分钟后订单自动 CLOSED

# 7. 回调丢失演练
#    临时把 notify_url 指向 404 → 用前端轮询确认仍能完成订单

# 8. 日志检查
#    grep "order.paid" /var/log/... → 确认审计日志完整
```

---

## 15. 关键文件清单（实施后）

```
inkpress-service/
├── prisma/
│   └── schema.prisma                        # 新增 Order + Plan model
├── src/
│   ├── lib/payment/
│   │   ├── plan-service.ts                  # Plan CRUD + getActivePlan
│   │   ├── order-service.ts                 # 订单创建/查询业务逻辑
│   │   ├── fulfill.ts                       # fulfillOrderIfPending（事务发券）
│   │   └── alipay/
│   │       ├── client.ts                    # SDK 单例
│   │       ├── api.ts                       # precreate 封装
│   │       └── verify.ts                    # 验签封装
│   ├── app/
│   │   ├── api/
│   │   │   ├── plans/route.ts               # GET 公开套餐列表
│   │   │   ├── orders/
│   │   │   │   ├── route.ts                 # POST 创建订单
│   │   │   │   └── [id]/route.ts            # GET 查询订单
│   │   │   ├── me/orders/route.ts           # GET 我的订单列表
│   │   │   ├── payments/alipay/notify/
│   │   │   │   └── route.ts                 # POST 回调
│   │   │   ├── admin/plans/                 # Plan CRUD
│   │   │   └── admin/orders/
│   │   │       ├── route.ts                 # GET 订单列表
│   │   │       └── [id]/route.ts            # GET 订单详情
│   │   ├── pricing/page.tsx                 # 套餐选择页
│   │   ├── checkout/
│   │   │   ├── page.tsx                     # 收银台
│   │   │   └── success/page.tsx             # 支付成功页
│   │   └── admin/
│   │       ├── plans/page.tsx               # 套餐管理
│   │       └── orders/
│   │           ├── page.tsx
│   │           └── [id]/page.tsx
│   └── components/payment/
│       ├── checkout-client.tsx              # 收银台客户端组件
│       ├── plan-card.tsx                    # 套餐卡片
│       └── order-status-badge.tsx
└── docs/alipay-payment-design.md            # 本文
```

---

## 16. FAQ

**Q1：为什么不用支付宝「电脑网站支付」（PC 网页跳转支付）？**
A：电脑网站支付需营业执照。当面付是个人实名即可开通的最低门槛产品，PC 端展示二维码让用户扫，体验差异不大。

**Q2：回调 notify_url 必须是 HTTPS 吗？**
A：支付宝要求 `notify_url` 必须公网可达，建议 HTTPS（生产环境 Caddy 已配置 HTTPS）。沙箱允许 HTTP。

**Q3：同一用户同时下多个订单会怎样？**
A：允许，每个订单独立 `outTradeNo`，用户扫哪个付哪个。但限制每用户最多 10 个 PENDING 订单防滥用。

**Q4：价格改了，老订单怎么办？**
A：Order 创建时即固化 `amountCents` + `planConfigJson`，与 Plan 当前配置完全解耦。改价只影响新订单，老订单仍按原价收款、按原配置发券。回调时校验的是订单固化的金额。

**Q5：License 发券用哪个账号？**
A：专用 `system@inkpress.local` 系统账号（`PAYMENT_SYSTEM_USER_ID`），审计日志 actor 清晰，不混用管理员账号。

**Q6：需要开发票吗？**
A：当面付个人收款无强制开票要求。若用户需要，后续接「百望云 / 诺诺网」等电子发票服务（需额外资质）。

**Q7：资金到账时间？**
A：当面付 T+1 自动结算到个人支付宝余额，无手续费扣除（0.6% 在交易时已扣）。

**Q8：如何测试回调？**
A：沙箱环境支付成功即触发回调。也可用支付宝「沙箱版买家 App」扫码模拟完整支付。

**Q9：precreate 返回的 qr_code 是链接还是数据？**
A：是 URL 字符串（形如 `https://qr.alipay.com/bax...`），前端用 `qrcode.react` 渲染成二维码图片。
