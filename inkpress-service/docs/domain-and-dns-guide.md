# 域名选购与 DNS 解析指南

> 配套文档：
> - `server-purchasing-guide.md`（服务器选购）
> - `deployment-production.md`（部署流程）
>
> 本文档专注：**买什么域名 / 在哪买 / 怎么配 DNS / 怎么保证国内稳定访问**。
>
> 前提：**不备案 + 国内能稳定访问 + 优先支付宝**。

---

## 0. 关键概念厘清

| 概念 | 说明 | 是否影响"不备案"诉求 |
|------|------|---------------------|
| **域名实名认证** | 域名注册商层面的身份核验 | ❌ 不影响，无论服务器在哪都需要（仅国内注册商强制） |
| **ICP 备案** | 工信部备案，绑定**服务器+域名** | ✅ 仅当服务器在**中国大陆境内**才强制 |
| **公安备案** | 公安系统登记 | ✅ 一般伴随 ICP 备案 |

**结论**：
- 用**海外注册商**买域名 → 不需要实名，更不需要备案
- 用**国内注册商**买域名 → **必须实名**（但不备案）
- 服务器在**海外/香港** → 域名不用备案就能用

---

## 1. 评估维度

| 维度 | 说明 | 权重 |
|------|------|------|
| **支付方式** | 支付宝 / 信用卡 / PayPal | ⭐⭐⭐⭐⭐ |
| **域名实名** | 是否强制上传身份证 | ⭐⭐⭐⭐ |
| **续费价格** | 避免首年低价陷阱 | ⭐⭐⭐⭐ |
| **隐私保护** | WHOIS 是否免费隐藏 | ⭐⭐⭐ |
| **DNS 性能** | 国内解析速度 | ⭐⭐⭐ |
| **管理面板** | 中文界面、操作流畅 | ⭐⭐⭐ |
| **域名转移** | 是否支持自由转出 | ⭐⭐ |

---

## 2. 域名注册商对比

### 2.1 总览

| 注册商 | 官网 | 支付宝 | 实名强制 | 续费透明度 | DNS | 推荐度 |
|--------|------|--------|---------|-----------|-----|--------|
| **Cloudflare Registrar** | cloudflare.com | ❌（信用卡） | 否 | 零加价（成本价续费） | 自带 | ⭐⭐⭐⭐⭐ |
| **Porkbun** | porkbun.com | ❌（信用卡/PayPal） | 否 | 透明 | 自带 | ⭐⭐⭐⭐ |
| **Namecheap** | namecheap.com | ❌（信用卡/PayPal） | 否 | 透明 | 自带 | ⭐⭐⭐ |
| **阿里云万网** | wanwang.aliyun.com | ✅ | **是**（强制） | 透明 | 阿里云 DNS | ⭐⭐⭐ |
| **腾讯云 DNSPod** | dnspod.cloud.tencent.com | ✅ | **是**（强制） | 透明 | DNSPod | ⭐⭐⭐ |
| **GoDaddy** | godaddy.com | ✅（部分区域） | 否 | 不透明（续费贵） | 自带 | ⭐⭐ |

### 2.2 两条路径选择

#### 路径 A：海外注册商（推荐）

**优点**：
- 无需实名，零摩擦
- 续费价格锁定（Cloudflare 是成本价）
- WHOIS 隐私保护免费
- 域名可随时转出

**缺点**：
- 不支持支付宝（仅信用卡 / PayPal）
- 部分用户没有国际支付手段

#### 路径 B：国内注册商（备选）

**优点**：
- 支付宝原生支付
- 中文界面，操作直观
- 售后方便

**缺点**：
- **必须实名**（上传身份证，1–3 个工作日审核）
- 续费价格通常高于海外（首年低价是惯例）
- 后续若想转到海外注册商有锁定期（一般 60 天）
- 国内注册商对 `.cn` / `.com.cn` 域名有更严格的审核

---

## 3. TLD 选择

### 3.1 推荐 TLD

| TLD | 价格（年） | 备注 | 推荐度 |
|-----|-----------|------|--------|
| **`.com`** | ~$10 | 通用、最稳、不会被特殊处理 | ⭐⭐⭐⭐⭐ |
| **`.org`** | ~$10 | 通用、稳 | ⭐⭐⭐⭐ |
| **`.io`** | ~$35 | 短酷，但价格贵 | ⭐⭐⭐ |
| **`.dev` / `.app`** | ~$15 | **强制 HTTPS**（HSTS preload），与本项目契合 | ⭐⭐⭐⭐ |
| **`.net`** | ~$12 | 通用 | ⭐⭐⭐ |

### 3.2 避免 TLD

| TLD | 避免原因 |
|-----|---------|
| `.top` `.xyz` `.icu` `.click` `.loan` `.vip` | 部分被国内 DNS 污染 / 标记为可疑 / 邮件被拒 |
| `.cn` / `.com.cn` | 国内注册商强制备案才能解析境外服务器（已超"不备案"前提） |
| `.tk` `.ml` `.ga` `.cf`（免费 TLD） | Freenom 已停止注册，且大量被国内屏蔽 |
| `.club` `.biz` `.info` | 部分邮箱系统标记为垃圾邮件 |

### 3.3 域名命名建议

- **避开敏感词**：含 `vpn` `proxy` `free` `crack` `warez` 等词的域名更容易被关注
- **简短**：短域名好记、好分享，对小项目友好
- **避开商标**：含 `apple` `microsoft` `github` 等商标词可能被仲裁
- **避免纯数字 / 含 `-`**：在口述、邮件里容易混淆

---

## 4. 域名选购流程

### 4.1 路径 A：Cloudflare Registrar（推荐）

#### 4.1.1 注册账号

1. 访问 https://dash.cloudflare.com/sign-up
2. 用邮箱注册（建议用常用邮箱，重要操作都会发邮件）
3. **必须绑定信用卡**（即使买 `.com` 域名也要）；不会扣年费，只在续费时扣

#### 4.1.2 搜索并购买域名

1. 登录后进入 https://dash.cloudflare.com
2. 左侧菜单 → **Domain Registration** → **Register Domain**
3. 输入想要的域名，例如 `inkpress-service.com`
4. 选 TLD，Cloudflare 会列出可选后缀和价格
5. 加入购物车 → **注意 ICANN 一次性注册费**（约 $0.18，强制）
6. 填写注册信息：
   - **Country**：选你的真实国家
   - **Address**：如实填写（Cloudflare 会用此信息做 WHOIS，但默认隐藏）
7. **开启 Auto-renew**（建议）+ **Enable privacy protection**（默认开启）
8. 提交支付

#### 4.1.3 Cloudflare 优势

- **零加价续费**：Cloudflare Registrar 承诺以成本价续费，不像其他注册商首年低、续费翻倍
- **自带 DNS**：买完域名自动托管到 Cloudflare DNS，无需额外配置 NS
- **免费 SSL**：可随时切到橙云启用 CDN（虽然不推荐主用）

### 4.2 路径 B：阿里云万网（支付宝路径）

#### 4.2.1 注册并实名

1. 访问 https://wanwang.aliyun.com
2. 用支付宝 / 淘宝账号登录
3. **个人实名认证**：上传身份证正反面 + 人脸识别，1 个工作日内审核
4. 完成后才能购买域名

#### 4.2.2 搜索并购买域名

1. 搜索想要的域名
2. 加购物车 → 结算（**选 1 年**，不要被默认 5/10 年误导）
3. 选支付宝扫码支付
4. 提交"域名所有者信息模板"（与实名认证信息一致）
5. 域名状态：**未实名 → 实名审核中 → 已实名**（约 1–3 个工作日）
6. 审核通过后才能解析

#### 4.2.3 注意事项

- 阿里云注册的域名可以**解析到任何 IP**（包括海外），不需要备案
- 但**若解析到中国大陆境内服务器**会被运营商拦（因为没备案）
- 解析到海外 / 香港服务器 → ✅ 正常访问

### 4.3 域名生命周期管理

| 阶段 | 说明 | 关键操作 |
|------|------|---------|
| 注册 | 第 0 天 | 开启 Auto-renew |
| 续费 | 到期前 30 天提醒 | 至少留 7 天缓冲 |
| 过期 | 到期当天 | 解析停止 |
| 赎回期 | 到期后 30 天 | 高价赎回（数百到数千元） |
| 删除 | 到期后 60–75 天 | 重新开放注册 |

**强烈建议**：
- 开启 Auto-renew
- 在密码管理器里记录续费日期
- 邮箱保持通畅（注册商续费提醒会发邮件）

---

## 5. DNS 解析配置

### 5.1 DNS 托管商选择

| 托管商 | 国内解析速度 | 价格 | 备注 |
|--------|------------|------|------|
| **Cloudflare DNS** | 良好 | 免费 | 抗攻击、API 强、可一键开 CDN |
| **DNSPod 国际版** | 优秀 | 免费（基础版） | 腾讯系，国内访问快 |
| **阿里云 DNS** | 优秀 | 免费（基础版） | 需要域名实名（即使海外买的域名也要） |
| **AWS Route 53** | 中等 | $0.50/zone/月 | 企业级，国内访问不如国内 DNS |
| **Google Cloud DNS** | 中等 | $0.20/zone/月 | 国内访问不稳 |

**推荐**：**Cloudflare DNS**（免费 + 稳定 + 配套 CDN）

### 5.2 Cloudflare DNS 配置步骤

#### 5.2.1 前置：域名 NS 切换（仅海外注册商需要）

如果是 **Cloudflare Registrar** 买的域名 → **跳过此步**，域名已默认托管。

如果是在 **Porkbun / Namecheap / GoDaddy** 买的域名 → 需要把 NS 切到 Cloudflare：

1. Cloudflare 控制台 → **Add a Site** → 输入你的域名（如 `example.com`）
2. 选择 **Free 计划**
3. Cloudflare 会给出两个 NS，例如：
   ```
   lloyd.ns.cloudflare.com
   mia.ns.cloudflare.com
   ```
4. 回到域名注册商面板 → **Nameservers** → 改为 Cloudflare 提供的两个 NS
5. 等待 NS 生效（10 分钟 – 24 小时），验证：
   ```bash
   dig NS example.com +short
   # 应返回 cloudflare 的两个 NS
   ```

#### 5.2.2 添加解析记录

进入 Cloudflare 域名面板 → **DNS** → **Records** → **Add record**：

| Type | Name | Content | Proxy Status | TTL | Purpose |
|------|------|---------|--------------|-----|---------|
| `A` | `inkpress` | `<服务器 IP>` | **DNS only**（灰云） | Auto | InkPress Service |
| `A` | `press` | `<主应用服务器 IP>` | DNS only | Auto | InkPress 主应用（如未来需要） |
| `A` | `@` | `<落地页 IP>` | DNS only | Auto | 根域（可选） |
| `CNAME` | `www` | `example.com` | DNS only | Auto | www 跳转（可选） |

#### 5.2.3 关键设置：DNS only（灰云）

⚠️ **重要**：Cloudflare DNS 记录的 **Proxy Status** 有两种：

| 模式 | 图标颜色 | 行为 |
|------|---------|------|
| **DNS only** | 灰云 ☁️ | 仅解析，A 记录直接返回你的源站 IP |
| **Proxied** | 橙云 ☁️ | 隐藏源站 IP，走 Cloudflare CDN |

**首次配置用 DNS only（灰云）**，原因：

1. 橙云会改写响应、注入 cookie，可能影响 Auth.js session
2. 橙云免费版对国内访问不一定比直连更好（CF 国内节点走美国/圣何塞）
3. 灰云便于调试（直接 ping 到你的源站 IP）

橙云可作为兜底方案（见 §7.3）。

### 5.3 验证 DNS 生效

```bash
# 本地
dig inkpress.example.com +short
# 应返回你的服务器 IP

# 国内多点
# 工具：https://ping.chinaz.com 或 https://itdog.cn
# 输入 inkpress.example.com，看各地解析结果
```

期望：**全国三网（电信/联通/移动）解析结果一致**，且与你配置的 IP 相同。

---

## 6. 国内稳定访问的核心原则

### 6.1 三种"被墙"形态

| 形态 | 现象 | 自检方法 |
|------|------|---------|
| **DNS 污染** | 国内 DNS 返回错误 IP（如 `127.0.0.1` / 墙外 IP） | `nslookup inkpress.example.com 8.8.8.8` 对比 `nslookup inkpress.example.com 223.5.5.5` |
| **IP 被墙** | IP 直接不通（ping 100% 丢包，TCP 也连不上） | 国外 ping 通、国内 ping 不通 |
| **域名被墙（SNI 阻断）** | IP 通，但访问该域名时 TLS 握手被 RST | 用 IP + Host 头访问能通，用域名访问被断 |

### 6.2 预防策略

#### 6.2.1 防 DNS 污染

- **使用海外注册商 + Cloudflare DNS**（强抗污染）
- **国内 DNS 也能拿到正确解析**（Cloudflare 国内合作节点会回应 AliDNS / DNSPod 等的递归查询）
- **不要使用 `.tk` `.ml` 等被广泛污染的 TLD**
- **避免在域名里含敏感词**

#### 6.2.2 防 IP 被墙

- **不要把同一 IP 跑代理服务**（如 V2Ray / Clash）—— License 服务的 IP 一旦被关联到代理流量，可能整个 IP 被墙
- **使用优化线路 IP**（CN2 GIA / BGP）—— 这些 IP 段运营商不太会主动屏蔽
- **多机房备胎**：DogYun 可换 IP，搬瓦工可切机房

#### 6.2.3 防 SNI 阻断

- **TLS 用标准端口 443**（不要用 8443 等非常规端口）
- **域名不含敏感词**
- **HTTPS 证书用 Let's Encrypt / Cloudflare**（不要自签）
- **Caddy / Nginx 默认 SNI 行为即可**（不要做任何伪装）

### 6.3 监控（推荐）

定期验证三网访问：

```bash
# 服务器侧：监控本机 IP 是否被墙
# 推荐工具：https://itdog.cn 站长拨测
# 设置：每天 ping 一次 inkpress.example.com，记录延迟/丢包
```

简易脚本（部署到第三方 VPS / GitHub Actions）：

```bash
#!/bin/bash
URL="https://inkpress.example.com/login"
# 全国多地点拨测（用 itdog API 或 chinaz 接口）
# 若连续 3 次失败，发邮件 / Telegram 告警
```

---

## 7. 进阶：稳定性优化

### 7.1 TTL 设置

- **Cloudflare 默认 Auto（约 300 秒）**：足够灵活，IP 切换时 5 分钟生效
- **不要把 TTL 设为 1 小时以上**：IP 被墙时切换成本太高
- **变更前临时降 TTL 到 60 秒**：提前 24 小时操作，让缓存尽快刷新

### 7.2 DNSSEC（可选加固）

Cloudflare DNS → **DNS** → **Settings** → **Enable DNSSEC**

- 防 DNS 劫持（中间人伪造解析）
- 在注册商面板把 DS 记录填入
- 部分老 DNS 不支持，需测试（一般阿里 / DNSPod 都支持）

### 7.3 Cloudflare 橙云兜底（紧急预案）

当源站 IP 被墙、晚高峰严重丢包、机房故障时：

1. Cloudflare DNS 面板 → 把该 A 记录的 **Proxy Status** 切为 **Proxied（橙云）**
2. **立刻生效**：用户访问会走 Cloudflare 节点
3. **源站配置调整**：
   - Caddy 需要从 Let's Encrypt 切到 **Cloudflare Origin CA 证书**（免费 15 年）
   - 开启 Cloudflare **Authenticated Origin Pulls**（防绕过 CF 直连源站）
4. **CF 免费版限制**：
   - 上传速度限制（一般 < 100 Mbps）
   - 部分国家的节点国内访问差（如美国节点）
   - WebSocket 长连接受超时限制（5 分钟）

> **橙云是临时兜底**：CF 国内访问质量取决于 CF 与运营商的互联情况，**不稳定**。问题解决后切回灰云直连。

### 7.4 多 IP 容灾（可选）

预算允许的话：

1. 买两台服务器（不同机房，如 DogYun 香港 + 搬瓦工 CN2 GIA）
2. Cloudflare DNS 配多条 A 记录（轮询）：
   ```
   inkpress.example.com.  300  IN  A  <香港 IP>
   inkpress.example.com.  300  IN  A  <美国 GIA IP>
   ```
3. 一台挂了，自动用另一台（DNS 轮询 + 健康检查）

但 SQLite 单机部署不支持双写，**主备模式**才适用（详见 §11）。

---

## 8. 验证清单（上线前必做）

依次确认：

- [ ] **WHOIS 隐私保护开启**（Cloudflare 默认开启；其他注册商检查）
- [ ] **域名续费设置**：Auto-renew ON + 邮箱通畅
- [ ] **NS 指向 DNS 托管商**（`dig NS example.com +short` 验证）
- [ ] **A 记录正确解析**（`dig inkpress.example.com +short` 返回服务器 IP）
- [ ] **全国三网解析一致**（chinaz / itdog 拨测通过）
- [ ] **TLS 证书有效**（`curl -I https://inkpress.example.com` 返回 200，无证书警告）
- [ ] **HSTS 头下发**（响应头含 `strict-transport-security`）
- [ ] **DNS 污染自检**：`nslookup inkpress.example.com 223.5.5.5` 与 `8.8.8.8` 对比，结果一致
- [ ] **DNSSEC（如启用）**：DS 记录已填入注册商

---

## 9. 故障排查

| 现象 | 可能原因 | 处理 |
|------|---------|------|
| 浏览器显示「无法解析此域名」 | DNS 未生效 / NS 未切 | `dig NS` 验证；等待 24h |
| 解析返回错误 IP（如 `127.0.0.1`） | DNS 污染 | 切到 Cloudflare DNS；启用 DNSSEC |
| 国内访问不了，国外能访问 | IP 被墙 | 换 IP（DogYun 后台 / 搬瓦工切机房） |
| 国外国内都访问不了 | 服务挂了 | `ssh` 进服务器查 `docker compose ps` |
| 偶尔断流，过几秒恢复 | 线路丢包 | 升级到 KC 精品 / 切到 CN2 GIA |
| 部分运营商不通，部分通 | 单线路问题 | 多 IP 容灾或换 BGP 优化的机房 |
| HTTPS 握手失败但 IP 通 | SNI 阻断 / 证书问题 | 用 IP + Host 测试；查证书是否过期 |

---

## 10. 推荐组合（最终建议）

### 10.1 方案 1：海外信用卡用户（最优体验）

```
域名：Cloudflare Registrar（.com / .dev / .app）
DNS： Cloudflare DNS（灰云，DNS only）
服务器：DogYun 香港-MG-BGP-s 或 搬瓦工 CN2 GIA-E
反代： Caddy 自动 HTTPS
```

- 总成本：~$10/年（域名）+ ¥20/月（服务器）
- 稳定性：⭐⭐⭐⭐⭐
- 抗干扰：⭐⭐⭐⭐⭐

### 10.2 方案 2：仅支付宝用户（推荐）

```
域名：阿里云万网（.com，需实名）
DNS： Cloudflare DNS（灰云）
服务器：DogYun 香港-MG-BGP-s
反代： Caddy 自动 HTTPS
```

- 总成本：~¥70/年（域名）+ ¥20/月（服务器）
- 稳定性：⭐⭐⭐⭐
- 抗干扰：⭐⭐⭐⭐（实名信息在国内注册商，但不影响免备案）

### 10.3 方案 3：全支付宝 + 国内 DNS（兜底）

```
域名：阿里云万网 / 腾讯云 DNSPod
DNS： 阿里云 DNS / DNSPod
服务器：DogYun 香港-MG-BGP-s
反代： Caddy 自动 HTTPS
```

- 总成本：同方案 2
- 稳定性：⭐⭐⭐⭐
- 抗干扰：⭐⭐⭐（国内 DNS 在污染场景下不如 CF）

---

## 11. 附录

### 11.1 关键命令速查

```bash
# 查 NS
dig NS example.com +short

# 查 A 记录（默认 DNS）
dig inkpress.example.com +short

# 指定 DNS 查（绕过本地缓存）
dig @8.8.8.8 inkpress.example.com +short
dig @1.1.1.1 inkpress.example.com +short
dig @223.5.5.5 inkpress.example.com +short  # 阿里 DNS

# 清本地 DNS 缓存（macOS）
sudo dscacheutil -flushcache && sudo killall -HUP mDNSResponder

# 清本地 DNS 缓存（Windows）
ipconfig /flushdns

# 路由追踪
mtr -r -c 100 inkpress.example.com
```

### 11.2 常用工具

| 工具 | 网址 | 用途 |
|------|------|------|
| 站长 ping | https://ping.chinaz.com | 国内多点 ping / 解析检测 |
| ITDOG | https://itdog.cn | 三网延迟 + 路由 + DNS 查询 |
| 拨测 | https://www.boce.com | 全国丢包率 |
| Cloudflare Status | https://www.cloudflarestatus.com | CF 各节点状态 |
| Let's Encrypt 状态 | https://letsencrypt.status.io | 证书颁发状态 |
| bgp.he.net | https://bgp.he.net | 查 IP 的 AS / BGP 路由 |

### 11.3 域名 / DNS 速查表

| 任务 | 在哪做 |
|------|--------|
| 买域名 | Cloudflare Registrar / 阿里云万网 |
| 改 NS（注册商） | 域名注册商面板 |
| 添加 A 记录 | DNS 托管商面板（Cloudflare） |
| 启用 DNSSEC | DNS 托管商 → 注册商面板（填 DS 记录） |
| 切灰云/橙云 | Cloudflare DNS Records |
| WHOIS 查询 | https://who.is |
| 域名注册信息核验 | https://rdap.org |

### 11.4 常见误区

| 误区 | 真相 |
|------|------|
| "域名实名就要备案" | ❌ 实名和备案是两回事，海外服务器不用备案 |
| "国内注册商的域名必须用国内服务器" | ❌ 解析到哪都行 |
| "海外买的域名国内访问不了" | ❌ 取决于 DNS 解析与服务器线路，与注册地无关 |
| "HTTPS 比 HTTP 在国内更易被墙" | ❌ 恰好相反，HTTPS 更难被精准识别 |
| "Cloudflare 橙云一定比直连稳" | ❌ 国内访问 CF 节点本身可能抖动 |
| "短 TTL 更好" | ⚠️ 短 TTL 增加查询压力；变更前临时降即可 |
