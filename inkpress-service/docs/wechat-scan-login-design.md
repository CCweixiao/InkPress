# 微信扫码关注公众号登录 — 技术设计

> 状态：**待实施**（前置条件：认证服务号 + 企业资质）
>
> 本文档完整描述方案选型、数据模型、API、加解密算法、公众号后台配置、
> 前端交互与实施步骤。拿到服务号后可直接按此文档开发。

---

## 1. 前置条件

| 条件 | 说明 | 当前状态 |
|---|---|---|
| **认证的服务号** | 订阅号即使认证也**没有**带参数二维码和消息推送接口 | ❌ 待办理 |
| **企业资质** | 服务号需企业/个体工商户/组织资质注册 | ❌ 待办理 |
| **微信认证** | 300 元/年，认证后才有高级接口权限 | ❌ |
| **已备案域名** | 公众号服务器配置需要 HTTPS 域名 | ✅ www.longoflow.com |
| **服务器公网 IP** | 加入微信 IP 白名单（调 access_token 需要） | ✅ 8.217.175.141 |

> **如果最终无法获得服务号**：改用「微信开放平台扫码登录」（纯登录，不涨粉），
> 需要 open.weixin.qq.com 认证（同样 300 元/年）。本方案不适用。

---

## 2. 方案选型

### 2.1 三种技术路线对比

| 方案 | 账号类型 | 扫码后行为 | 涨粉 | 接口复杂度 |
|---|---|---|---|---|
| **A. 服务号带参数二维码** | 认证服务号 | 关注公众号 + 登录 | ✅ | 中（回调 + 加解密） |
| B. 开放平台扫码登录 | 开放平台认证 | 仅登录 | ❌ | 低（标准 OAuth2） |
| C. 订阅号 | 任意订阅号 | — | — | ❌ 无此接口权限 |

**InkPress 选择方案 A**：内容平台的核心价值是「登录即涨粉」，用户扫码关注后，
公众号成为内容分发通道（推文、模板消息通知），与 InkPress 的写作发布场景天然契合。

### 2.2 方案 A 核心机制

微信公众号提供「带参数临时二维码」能力：

1. 服务端调用微信 API，传入自定义 `scene_str` 生成临时二维码
2. 用户扫码后：
   - **未关注** → 自动关注公众号 → 微信推送 `subscribe` 事件（含 `EventKey=qrscene_<scene_str>`）
   - **已关注** → 直接推送 `SCAN` 事件（含 `EventKey=<scene_str>`）
3. 服务端收到事件推送，从 `scene_str` 关联到浏览器会话，完成登录

---

## 3. 端到端时序

```
浏览器                       inkpress-service              微信服务器
  │                              │                           │
  │ ① 点击"微信扫码登录"           │                           │
  ├────────────────────────────►│                           │
  │                              │ ② 生成 scene_str            │
  │                              │   存 WeChatLoginTicket       │
  │                              │   status=PENDING             │
  │                              │ ③ POST cgi-bin/qrcode/create │
  │                              │   scene_str=wl_a3f9k2x7     │
  │                              │ ◄─────────────────────────  │
  │                              │   返回 ticket + qr_url       │
  │ ④ 返回二维码 URL + scene      │                           │
  │ ◄───────────────────────────┤                           │
  │                              │                           │
  │ ⑤ 展示二维码                 │                           │
  │   每 2s 轮询 status           │                           │
  ├────────────────────────────►│                           │
  │                              │ 查 DB ticket.status         │
  │ ⑥ 返回 PENDING               │                           │
  │ ◄───────────────────────────┤                           │
  │                              │                           │
  │                 用户用微信扫码 → 点击关注                    │
  │                              │                           │
  │                              │ ⑦ 微信推送 subscribe 事件    │
  │                              │ ◄─────────────────────────  │
  │                              │   POST /api/wechat/callback │
  │                              │   (AES 加密的 XML)           │
  │                              │ ⑧ 解密 → 提取 scene + openid │
  │                              │   ticket.status=CONFIRMED    │
  │                              │   ticket.openid=xxx          │
  │                              │   （可选）拉 userinfo 拿昵称  │
  │                              │                           │
  │ ⑨ 轮询返回 CONFIRMED + login_token │                      │
  │ ◄───────────────────────────┤                           │
  │                              │                           │
  │ ⑩ signIn("wechat",{login_token}) │                       │
  ├────────────────────────────►│                           │
  │                              │ 验证 login_token            │
  │                              │ 查找/创建 User + Account     │
  │                              │ 签发 JWT                     │
  │ ⑪ 重定向到 /dashboard        │                           │
  │ ◄───────────────────────────┤                           │
```

---

## 4. 数据模型

### 4.1 新增 WeChatLoginTicket 表

```prisma
model WeChatLoginTicket {
  id           String    @id @default(cuid())
  // 传给微信的 scene_str，格式 wl_<22位随机>，一次性消费
  scene        String    @unique
  // 浏览器会话标识（httpOnly cookie），轮询隔离 + CSRF 防护
  browserSid   String
  // PENDING → SCANNED（可选） → CONFIRMED / EXPIRED
  status       String    @default("PENDING")
  // 微信回调时填充
  openid       String?
  unionid      String?
  nickname     String?
  avatar       String?
  // 一次性消费 token，CONFIRMED 时生成，signIn 后失效
  loginToken   String?
  // 审计
  createdIp    String?
  createdAt    DateTime  @default(now())
  scannedAt    DateTime?
  confirmedAt  DateTime?
  expiresAt    DateTime  // 5 分钟

  @@index([browserSid, status, expiresAt])
  @@index([scene])
  @@index([expiresAt])
}
```

### 4.2 复用 Account 表绑定微信用户

与 GitHub OAuth 一致，通过 NextAuth PrismaAdapter 的 Account 表：

| 字段 | 值 |
|---|---|
| `provider` | `"wechat"` |
| `providerAccountId` | openid |
| `type` | `"oauth"` |

首次扫码自动创建 User + Account。

### 4.3 email 处理策略

微信不返回 email，但 `User.email` 是 `@unique` 非空字段。方案：

```
首次扫码 → 创建 User，email = "<openid>@wechat.placeholder"
         → mustChangePassword = false，passwordHash = null
         → role = "USER", status = "ACTIVE"

后续在个人中心 → 引导补填真实邮箱（不强制，仅用于邮件通知）
```

> 如果未来 email 需要支持为空，需改 schema `email String?` + 调整唯一约束，
> 影响面较大（注册、登录、License 绑定都依赖 email），暂用 placeholder 方案。

---

## 5. API 接口设计

### 5.1 创建二维码

```
POST /api/auth/wechat/qrcode
```

| 项 | 说明 |
|---|---|
| 认证 | 无（登录前接口） |
| Body | 无（browserSid 从 httpOnly cookie 自动获取） |
| 限流 | 10 次/分钟/IP |

**逻辑：**
1. 从 cookie 取 `wechat_sid`（不存在则生成并 Set-Cookie，Max-Age=10min，httpOnly, secure, sameSite=lax）
2. 生成 scene：`wl_` + `crypto.randomBytes(11).toString('base64url').slice(0, 22)`
3. 创建 `WeChatLoginTicket`（status=PENDING, expiresAt=now+5min, browserSid）
4. 调用微信 `POST cgi-bin/qrcode/create`（expire_seconds=300, action_name=QR_STR_SCENE）
5. 返回响应

**响应：**
```json
{
  "ok": true,
  "data": {
    "scene": "wl_a3f9k2x7mNp...",
    "qrImageUrl": "https://mp.weixin.qq.com/cgi-bin/showqrcode?ticket=gQH47zo...",
    "expiresAt": "2026-07-04T18:30:00.000Z"
  }
}
```

### 5.2 轮询登录状态

```
GET /api/auth/wechat/status?scene=wl_xxx
```

| 项 | 说明 |
|---|---|
| 认证 | 无 |
| 限流 | 1 次/2 秒/browserSid |

**逻辑：**
1. 从 cookie 取 browserSid，校验与 ticket.browserSid 一致（CSRF 防护）
2. 查 ticket where scene=xxx
3. 根据 status 返回不同响应

**响应（PENDING/SCANNED）：**
```json
{
  "ok": true,
  "data": { "status": "PENDING" }
}
```

**响应（CONFIRMED）：**
```json
{
  "ok": true,
  "data": {
    "status": "CONFIRMED",
    "loginToken": "lt_7f3a9b2c..."  // 一次性，用于 signIn("wechat")
  }
}
```

**响应（EXPIRED）：**
```json
{
  "ok": true,
  "data": { "status": "EXPIRED" }
}
```

### 5.3 微信回调 — 服务器配置校验（GET）

```
GET /api/wechat/callback?signature=&timestamp=&nonce=&echostr=
```

微信在公众号后台保存服务器配置时，会发 GET 请求验证服务器有效性。

**逻辑：**
1. 将 `token`、`timestamp`、`nonce` 字典序排序后拼接
2. SHA-1 摘要，与 `signature` 比较
3. 匹配则原样返回 `echostr`

```typescript
function verifySignature(token: string, timestamp: string, nonce: string, signature: string): boolean {
  const arr = [token, timestamp, nonce].sort();
  const sha1 = crypto.createHash("sha1").update(arr.join("")).digest("hex");
  return sha1 === signature;
}
```

### 5.4 微信回调 — 事件推送（POST）

```
POST /api/wechat/callback?signature=&timestamp=&nonce=&encrypt_type=aes&msg_signature=
Body: XML（AES 加密）
```

**逻辑：**
1. **验签**：`sha1(sort([token, timestamp, nonce, encrypt]).join("")) == msg_signature`
2. **解密**：AES-256-CBC 解密（算法见 §6.3）
3. 解析 XML，提取 `MsgType`、`Event`、`EventKey`、`FromUserName`(openid)
4. 路由事件：

| 事件 | EventKey 格式 | 含义 |
|---|---|---|
| `subscribe` | `qrscene_<scene>` | 未关注用户扫码后关注 |
| `SCAN` | `<scene>` | 已关注用户扫码 |

5. 从 EventKey 提取 scene → 查 ticket → 验证未过期未消费
6. 填充 ticket：`openid`、`status=CONFIRMED`、`confirmedAt=now`
7. 生成 `loginToken`（一次性，`crypto.randomBytes(24).toString('base64url')`）
8. （可选）调 `cgi-bin/user/info` 拉昵称头像
9. 返回 XML `"success"`（或加密后的 XML）

**回调安全：**
- 必须在 5 秒内响应，否则微信会重试（最多 3 次）
- 微信服务器 IP 段校验（可选增强，`cgi-bin/getcallbackip` 获取出口 IP 列表）

### 5.5 Auth.js 微信 Provider

```typescript
// src/auth.ts 新增 provider
Credentials({
  id: "wechat",
  credentials: {
    loginToken: { label: "Login Token", type: "text" },
  },
  async authorize(creds) {
    const loginToken = String(creds?.loginToken ?? "");
    if (!loginToken) return null;

    // 1. 查 ticket where loginToken=xxx AND status=CONFIRMED
    const ticket = await prisma.weChatLoginTicket.findFirst({
      where: { loginToken, status: "CONFIRMED", expiresAt: { gt: new Date() } },
    });
    if (!ticket) return null;

    // 2. 查找或创建 User + Account
    const account = await prisma.account.findUnique({
      where: {
        provider_providerAccountId: {
          provider: "wechat",
          providerAccountId: ticket.openid!,
        },
      },
      include: { user: true },
    });

    let user = account?.user;
    if (!user) {
      // 首次扫码：创建 User + Account
      user = await prisma.user.create({
        data: {
          email: `${ticket.openid}@wechat.placeholder`,
          name: ticket.nickname ?? null,
          image: ticket.avatar ?? null,
          emailVerified: new Date(),
          status: "ACTIVE",
          role: "USER",
          accounts: {
            create: {
              provider: "wechat",
              providerAccountId: ticket.openid!,
              type: "oauth",
            },
          },
        },
      });
      // 触发 invitation code 生成（与 GitHub 首登一致）
      await ensureUserInvitationCode(user.id);
    }

    // 3. 消费 loginToken（一次性）
    await prisma.weChatLoginTicket.update({
      where: { id: ticket.id },
      data: { loginToken: null, status: "CONFIRMED" },
    });

    // 4. 返回 user object（jwt callback 接管）
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      image: user.image,
      role: user.role,
      status: user.status,
      mustChangePassword: user.mustChangePassword,
    };
  },
}),
```

---

## 6. 微信 API 封装层

新建 `src/lib/wechat/`：

### 6.1 access_token 管理

access_token 是全局资源：同一 AppID 只有一个活跃 token，有效期 7200 秒，
多次获取会使前一个失效。**必须缓存**。

```
GET https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=APPID&secret=SECRET

成功：{ "access_token": "xxx", "expires_in": 7200 }
失败：{ "errcode": 40013, "errmsg": "invalid appid" }
```

**缓存策略（单实例）：**

```typescript
// src/lib/wechat/access-token.ts
let cachedToken: { value: string; expiresAt: number } | null = null;

export async function getAccessToken(): Promise<string> {
  // 提前 5 分钟刷新，避免边界过期
  if (cachedToken && cachedToken.expiresAt > Date.now() + 5 * 60 * 1000) {
    return cachedToken.value;
  }

  const url = `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${APP_ID}&secret=${APP_SECRET}`;
  const resp = await fetch(url).then(r => r.json());

  if (resp.errcode) {
    throw new Error(`WeChat token error: ${resp.errcode} ${resp.errmsg}`);
  }

  cachedToken = {
    value: resp.access_token,
    expiresAt: Date.now() + resp.expires_in * 1000,
  };
  return cachedToken.value;
}
```

> **多实例部署时**：改用 Redis + 分布式锁（SET NX + EX）共享 token，
> 避免多实例并发刷新导致互相失效。当前单实例 SQLite 阶段用内存缓存即可。

### 6.2 带参数临时二维码

```
POST https://api.weixin.qq.com/cgi-bin/qrcode/create?access_token=TOKEN
Content-Type: application/json

{
  "expire_seconds": 300,
  "action_name": "QR_STR_SCENE",
  "action_info": {
    "scene": { "scene_str": "wl_a3f9k2x7mNp" }
  }
}

成功：{
  "ticket": "gQH47zoAAAAAAAAAAS5odHRwOi8vd2V4aW4ucXEuY29tL3Ev...",
  "expire_seconds": 300,
  "url": "https://weixin.qq.com/q/xxx"
}
```

二维码图片：`https://mp.weixin.qq.com/cgi-bin/showqrcode?ticket=<TICKET>`（直接作为 `<img src>` 使用）

**限制：**
- 临时二维码 expire_seconds 最大 2592000（30 天）
- scene_str 最长 64 字符
- 每天生成上限 100 万个

### 6.3 消息加解密算法（核心）

微信「安全模式」下，所有消息用 AES-256-CBC 加密。算法：

**密钥派生：**
```
EncodingAESKey（43 字符 base64）→ base64decode + "=" → 32 字节 AES 密钥
IV = 密钥的前 16 字节
```

**加密流程：**
```
明文 = random(16 字节) + msg_len(4 字节, big-endian) + msg(UTF-8 XML) + receiveid(AppID)
填充 = PKCS7 填充，块大小 = 32 字节（微信自定义，非标准 16 字节！）
密文 = AES-256-CBC(明文 + 填充, key, iv)
输出 = base64(密文)
```

**解密流程：**
```
密文 = base64decode(input)
明文+填充 = AES-256-CBC-decrypt(密文, key, iv)
去填充 = 移除末尾 PKCS7 填充字节
random = 明文[0:16]
msg_len = readUInt32BE(明文[16:20])
msg = 明文[20 : 20+msg_len]
receiveid = 明文[20+msg_len :]
```

**PKCS7 填充（块大小 32）：**
```typescript
function pkcs7Pad(data: Buffer): Buffer {
  const blockSize = 32;
  const padLen = blockSize - (data.length % blockSize);
  const padding = Buffer.alloc(padLen, padLen);
  return Buffer.concat([data, padding]);
}

function pkcs7Unpad(data: Buffer): Buffer {
  const padLen = data[data.length - 1];
  return data.subarray(0, data.length - padLen);
}
```

> Node.js 社区库：`@wecom/crypto`（企业微信/公众号通用加解密），
> 或自行实现。手动实现约 40 行代码。

### 6.4 XML 消息格式

**加密后的回调 XML（微信 POST 过来的）：**
```xml
<xml>
  <ToUserName><![CDATA[gh_xxx]]></ToUserName>
  <Encrypt><![CDATA[base64_encrypted_payload]]></Encrypt>
</xml>
```

**解密后的事件消息（subscribe 事件）：**
```xml
<xml>
  <ToUserName><![CDATA[gh_xxx]]></ToUserName>
  <FromUserName><![CDATA[oGMxxx_user_openid]]></FromUserName>
  <CreateTime>1719500000</CreateTime>
  <MsgType><![CDATA[event]]></MsgType>
  <Event><![CDATA[subscribe]]></Event>
  <EventKey><![CDATA[qrscene_wl_a3f9k2x7mNp]]></EventKey>
  <Ticket><![CDATA[gQH47zoAAAAAAAAAAS5...]]></Ticket>
</xml>
```

**已关注用户的 SCAN 事件：**
```xml
<xml>
  <MsgType><![CDATA[event]]></MsgType>
  <Event><![CDATA[SCAN]]></Event>
  <EventKey><![CDATA[wl_a3f9k2x7mNp]]></EventKey>
  <!-- 注意：SCAN 事件的 EventKey 没有 qrscene_ 前缀 -->
  <Ticket><![CDATA[gQH47zoAAAAAAAAAAS5...]]></Ticket>
</xml>
```

### 6.5 用户信息（可选）

```
GET https://api.weixin.qq.com/cgi-bin/user/info?access_token=TOKEN&openid=OPENID&lang=zh_CN

响应：{
  "openid": "oGM...",
  "nickname": "张三",
  "headimgurl": "https://thirdwx.qlogo.cn/...",
  "subscribe": 1,
  "subscribe_time": 1719500000,
  "unionid": "o6_bmjrOPkm..."  // 仅当绑定了开放平台
}
```

> **注意：** 2021 年微信隐私调整后，新关注的用户 nickname 可能包含 emoji，
> headimgurl 可能为空。昵称建议入库前做 UTF-8 MB4 清洗。

---

## 7. 安全设计

| 威胁 | 防御措施 |
|---|---|
| **票据重放** | loginToken 一次性消费，signIn 后立即置 null；scene 一次性 |
| **票据劫持** | 5 分钟过期；scene 绑定 browserSid（cookie），轮询/换 token 时校验一致 |
| **伪造微信回调** | `sha1(sort([token,timestamp,nonce,encrypt])) == msg_signature` 验签 |
| **消息篡改** | AES-256-CBC + EncodingAESKey，密文不可伪造 |
| **伪造二维码** | scene 由服务端生成（22 字符随机 base64url），二维码必须从微信 API 获取 |
| **CSRF** | browserSid 通过 httpOnly + sameSite=lax cookie 传递，不暴露给 JS |
| **频率攻击** | 二维码创建 10/min/IP；轮询 1/2s/session；复用现有 rate-limit |
| **openid 绑定冲突** | Account 表 `@@unique([provider, providerAccountId])` 天然防重复 |
| **access_token 泄露** | 仅服务端持有，不下发前端；IP 白名单保护 |

---

## 8. 环境变量

### 8.1 新增配置（.env.example）

```env
# ===== 微信公众号扫码登录 =====
# 认证服务号（订阅号无此能力）
WECHAT_APP_ID=""
WECHAT_APP_SECRET=""
# 服务器配置中的 Token（自定义，用于验签）
WECHAT_TOKEN=""
# 消息加解密密钥（43 字符 base64，微信公众号后台生成）
WECHAT_ENCODING_AES_KEY=""
# 前端开关：设为 "1" 时登录页显示微信扫码入口
NEXT_PUBLIC_WECHAT_ENABLED=""
```

### 8.2 EncodingAESKey 生成

```bash
# 生成 43 字符 base64 密钥（32 字节密钥 → 44 字符 base64 → 去掉末尾 = → 43 字符）
openssl rand -base64 32 | tr -d '=' | cut -c1-43
```

---

## 9. 公众号后台配置步骤

### 9.1 开发 → 基本配置 → IP 白名单

将服务器公网 IP 加入白plist（调 access_token 必须）：
```
8.217.175.141
```

### 9.2 开发 → 基本配置 → 服务器配置

| 配置项 | 值 |
|---|---|
| URL | `https://www.longoflow.com/api/wechat/callback` |
| Token | 与 `WECHAT_TOKEN` 一致（自定义字符串） |
| EncodingAESKey | 与 `WECHAT_ENCODING_AES_KEY` 一致 |
| 消息加解密方式 | **安全模式**（推荐，全部消息加密） |
| 数据格式 | XML |

保存时微信会 GET 你的 callback 验证，需先部署好 §5.3 接口。

### 9.3 设置 → 公众号设置 → 功能设置

| 配置项 | 值 |
|---|---|
| 业务域名 | `https://www.longoflow.com`（需上传校验文件） |
| JS 接口安全域名 | `www.longoflow.com`（如需 JS-SDK） |

### 9.4 接口权限检查

在公众号后台 → 接口权限 确认以下已开通（认证服务号默认有）：
- ✅ 获取 access_token
- ✅ 创建带参数二维码
- ✅ 接收事件推送
- ✅ 获取用户基本信息

---

## 10. 前端交互设计

### 10.1 登录页布局

`NEXT_PUBLIC_WECHAT_ENABLED === "1"` 时显示微信入口：

```
┌─────────────────────────────────────┐
│         InkPress 登录                │
│                                     │
│  [ 📧 邮箱登录 ]  [ 🐙 GitHub ]  [ 💬 微信 ]  │
│                                     │
│  ┌─────────────────────────┐        │
│  │                         │        │
│  │   ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓     │        │
│  │   ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓     │        │  ← 微信二维码
│  │   ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓     │        │
│  │                         │        │
│  └─────────────────────────┘        │
│                                     │
│  📱 请使用微信扫码关注公众号登录       │
│  ⏳ 二维码 04:32 后过期               │
│                                     │
│  [ 🔄 刷新二维码 ]                    │  ← 过期后显示
└─────────────────────────────────────┘
```

### 10.2 状态流转与文案

| 状态 | 文案 | 前端行为 |
|---|---|---|
| PENDING | "请使用微信扫码关注公众号" | 继续轮询 |
| SCANNED | "扫码成功，请在手机上确认关注" | 继续轮询（可选状态） |
| CONFIRMED | "登录成功，正在跳转..." | 停止轮询，`signIn("wechat")` |
| EXPIRED | "二维码已过期" | 停止轮询，显示刷新按钮 |
| ERROR | "登录失败，请重试" | 停止轮询，显示刷新按钮 |

### 10.3 轮询策略

```typescript
// 每 2 秒轮询，指数退避（2s 基线），最多 150 次 = 5 分钟
const POLL_INTERVAL = 2000;
const POLL_MAX_TIMES = 150;

useEffect(() => {
  let timer: NodeJS.Timeout;
  let times = 0;

  const poll = async () => {
    const resp = await fetch(`/api/auth/wechat/status?scene=${scene}`);
    const { data } = await resp.json();

    if (data.status === "CONFIRMED" && data.loginToken) {
      await signIn("wechat", { loginToken: data.loginToken, redirect: true, callbackUrl: "/dashboard" });
      return;
    }
    if (data.status === "EXPIRED") {
      setStatus("EXPIRED");
      return;
    }

    times++;
    if (times < POLL_MAX_TIMES) {
      timer = setTimeout(poll, POLL_INTERVAL);
    }
  };

  poll();
  return () => clearTimeout(timer);
}, [scene]);
```

---

## 11. 账号合并策略

### 场景：用户先用邮箱注册，后用微信扫码

| 策略 | 描述 | 优缺点 |
|---|---|---|
| **A. 独立账号（推荐初期）** | 微信扫码创建新账号，email=`<openid>@wechat.placeholder` | 简单；但同一人有两个账号 |
| B. 手动合并 | 微信首次登录后，个人中心补填 email → 发现已存在 → 引导密码验证后合并 | 安全；但体验略重 |
| C. unionid 自动合并 | 需绑定开放平台，用 unionid 跨端匹配 | 最丝滑；但需额外开通开放平台 |

**推荐初期用策略 A**，后续根据业务需要升级到 B 或 C。

---

## 12. 实施步骤（4 个 PR）

| PR | 范围 | 关键文件 |
|---|---|---|
| **PR1：基础设施** | WeChatLoginTicket 表 + 迁移；微信 API 封装（access_token 缓存、二维码生成、消息加解密）；环境变量 | `prisma/schema.prisma`, `src/lib/wechat/*.ts`, `.env.example` |
| **PR2：回调链路** | GET/POST `/api/wechat/callback`（验签 + AES 解密 + 事件路由 + ticket 状态更新） | `src/app/api/wechat/callback/route.ts` |
| **PR3：登录链路** | qrcode 创建 + status 轮询 + Auth.js wechat provider + 账号创建/绑定 | `src/app/api/auth/wechat/qrcode/route.ts`, `src/app/api/auth/wechat/status/route.ts`, `src/auth.ts` |
| **PR4：前端 + 收尾** | 登录页微信扫码组件、轮询 hook、个人中心补填 email、文档 | `src/app/login/page.tsx`, `src/components/auth/wechat-login.tsx` |

---

## 13. FAQ

### Q: 订阅号能不能做扫码登录？
不能。订阅号（即使认证）没有「带参数二维码」和「接收事件推送」高级接口权限。必须服务号。

### Q: 个人开发者没有企业资质怎么办？
三个选择：
1. 注册个体工商户（成本最低，几百元/年记账）
2. 用微信开放平台扫码登录（不涨粉，但能登录）
3. 放弃微信登录，只保留邮箱 + GitHub

### Q: access_token 会不会并发冲突？
单实例用内存缓存没问题。多实例部署时必须用 Redis 共享 + 分布式锁，
否则两个实例同时刷新会导致互相失效。当前单实例阶段不用担心。

### Q: 微信回调超时怎么办？
微信要求 5 秒内响应。如果处理逻辑慢（如拉 userinfo），先返回 `"success"`，
把后续处理改为异步（写队列或直接在响应后 `Promise.resolve().then(...)` 不 await）。

### Q: 二维码过期了用户还在扫码怎么办？
ticket.expiresAt 已过期，微信推送事件时服务端验证 ticket 发现 EXPIRED，
不更新状态。前端轮询也会拿到 EXPIRED，提示用户刷新。用户需重新生成二维码。

### Q: 用户取消关注会影响登录吗？
不影响。关注动作只在扫码瞬间触发 subscribe 事件，之后取关不会撤销已完成的登录。
但可以考虑监听 unsubscribe 事件做业务处理（如标记用户已取关）。

---

## 14. 参考文档

- [微信公众号带参数二维码](https://developers.weixin.qq.com/doc/offiaccount/Account_Management/Generating_a_Parametric_QR_Code.html)
- [接收事件推送](https://developers.weixin.qq.com/doc/offiaccount/Message_Management/Receiving_event_pushes.html)
- [消息加解密说明](https://developers.weixin.qq.com/doc/oplatform/Third-party_Platforms/Message_Encryption/Message_Encryption_and_Decryption.html)
- [获取 access_token](https://developers.weixin.qq.com/doc/offiaccount/Basic_Information/Get_access_token.html)
- [获取用户信息](https://developers.weixin.qq.com/doc/offiaccount/User_Management/Get_users_basic_information_UnionID.html)
