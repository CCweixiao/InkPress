# InkPress 模型配置指引｜以智谱 GLM 为例，从注册到接入只需 5 步

InkPress 的写作 Agent 走的是 **Anthropic /messages 协议**，所以你只要给它接一个"会讲 Anthropic 协议"的大模型后端，就能让对话、Skill、工具调用整条链路跑起来。智谱 GLM 因为官方提供了 Anthropic 兼容端点，是目前性价比最高的国产方案之一。

这篇指引以智谱 GLM 为完整示例，覆盖**注册 → 订阅 → 申请 Key → 在 InkPress 里配置 → 验证连通**的 5 个步骤；MiniMax、Kimi、OpenRouter 等其他模型的申请入口放在文末"其他模型"小节，按需取用。

---

## 一、开始之前

完成本指引你需要：

- 一台能正常打开 [bigmodel.cn](https://bigmodel.cn) 的电脑
- 一个手机号或邮箱（用于注册智谱开放平台）
- 一个可用的支付方式（订阅套餐时使用；如果只用免费额度或按量计费，可跳过）
- 已安装并打开 InkPress

> 💡 整个流程大约需要 **5–10 分钟**（不含订阅决策时间）。

---

## 二、第 1 步：通过邀请链接注册，领取 2000 万 Tokens 大礼包

打开下面的邀请链接进行注册（直接扫码或粘贴到浏览器均可）：

> https://www.bigmodel.cn/invite?icode=rkw9sQRJaMRrflSZXYH2p%2Bnfet45IvM%2BqDogImfeLyI%3D

通过邀请链接注册的新用户，会获得 **2000 万 Tokens 大礼包**，可以用来在 InkPress 里跑通整套写作 Agent 流程，基本足够你试出"到底够不够用"。

![智谱模型邀请码图片，通过邀请订阅套餐有优惠](/guide-images/2026-07-05/0e03f2b8-82c4-4bf6-8714-a0c727a19af7.png)

注册并登录后，会进入 [BigModel 控制台](https://bigmodel.cn)。第一次进入建议先在「财务 / 用量统计」里确认 2000 万 Tokens 已经到账，再继续下一步。

---

## 三、第 2 步：订阅 GLM Coding Plan（可选，但推荐）

**前置条件**：已完成第 1 步注册。

打开 [https://bigmodel.cn/glm-coding](https://bigmodel.cn/glm-coding)，这就是 Coding Plan 的订阅入口。

![订阅 coding plan 的导航入口页截图](/guide-images/2026-07-05/785da9d7-f2bd-4b07-9cee-39eeac5e5af5.png)

### 三档套餐怎么选

按官方文档（[套餐概览](https://docs.bigmodel.cn/cn/coding-plan/overview)），所有套餐均支持 **GLM-5.2、GLM-5-Turbo、GLM-4.7**；调用旧的 GLM-5.1/GLM-5 会自动切到 GLM-5.2。三档的核心差异是调用频次：

| 套餐 | 每 5 小时限额 | 每周限额 | MCP/月（联网搜索/网页读取/开源仓库）|
|---|---|---|---|
| **Lite** | 约 80 次 prompts | 约 400 次 prompts | 100 次 |
| **Pro** | 约 400 次 prompts | 约 2,000 次 prompts | 1,000 次 |
| **Max** | 约 1,600 次 prompts | 约 8,000 次 prompts | 4,000 次 |

> 一次 prompt 预计会调用模型 15–20 次（含工具调用、上下文回读），所以"400 次 prompts"≈ 6,000–8,000 次实际模型调用。每周限额比 5 小时限额更值得参考。

**给不同用户的建议**：

- 🟢 **轻度用户**（每周写 2–3 篇公众号文章、偶尔润色）→ **Lite 足够**，先用免费额度 + Lite 跑一周，看是否触顶。
- 🟡 **中度用户**（每天写作、多篇文章并行、频繁用 Skill）→ **Pro 更稳**，5 小时窗口宽 5 倍，不容易在赶稿高峰被限流。
- 🔴 **重度用户 / 团队**（多账号、长文长会话、并发任务）→ **Max**，并优先考虑官方刚推出的「团队版」。

> 价格随活动和季度调整（2026 年起取消过首单大额优惠），具体数字请以订阅页实时显示为准，本指引不写死。

### ⚠️ 一个必须知道的前提

Coding Plan 的官方说明里写明：**"套餐仅限在官方支持的指定工具与产品环境中使用。"** Anthropic 兼容端点 (`https://open.bigmodel.cn/api/anthropic`) 也是为 Claude Code、Cline、Cursor 这类工具准备的。

InkPress 走的是同样的 Anthropic /messages 协议，**端点配置是通的**（InkPress 已内置 GLM 预设并验证），但套餐额度是否会计入 InkPress 的调用，**以 BigModel 官方实时规则为准**。订阅前如果不确定，可以：
1. 先用第 1 步的 **2000 万 Tokens 免费额度**在 InkPress 里跑通整条流程；
2. 或准备一份**按量计费的 API 余额**作为兜底（即使套餐不计入，也能正常调用）。

---

## 四、第 3 步：创建并复制 API Key

**前置条件**：已注册并（如需）完成订阅。

打开 [https://bigmodel.cn/apikey/platform](https://bigmodel.cn/apikey/platform)。

**1. 点击「创建 API Key」**：

![点击创建 api key 的截图](/guide-images/2026-07-05/7fdcb23a-3f2d-4c80-b0d2-a04f7911683b.png)

**2. 给 Key 起个名字**（例如 `inkpress-personal`），方便以后在多个设备 / 工具之间区分。提交后会在列表里看到新创建的 Key。

**3. 复制 Key**：在 API Key 列表里找到刚创建的那一条，点右侧的复制按钮。

![api key 列表截图，选择创建好的 api key，点击复制按钮，复制 api-key，注意保密](/guide-images/2026-07-05/99e85b97-fd22-45d9-b79d-807eaf63b48b.png)

> ⚠️ **保密**：API Key 等同于你的账户密码，泄露会被盗刷额度。复制时确认没有多空格、没有多换行。Key 只在创建时完整可见，**离开页面后只能看前几位**，请第一时间贴到 InkPress 或密码管理器里。

---

## 五、第 4 步：在 InkPress 里配置 GLM

**前置条件**：已经拿到上一节的 API Key，并打开 InkPress。

**1. 进入设置页**：打开 InkPress → 左下角「设置」→ 找到 **AI 大模型 / LLM**（旧版本叫"Claude Agent 后端"）这一栏。

**2. 选择预设「智谱 GLM」**（推荐方式）：在供应商下拉里直接选 **「智谱 GLM」**，三个关键字段会自动带出：

| 字段 | 自动填入的值 |
|---|---|
| `baseUrl` | `https://open.bigmodel.cn/api/anthropic` |
| `apiProvider` | `Anthropic /messages`（只读） |
| 可选模型 | GLM-4.6、GLM-4.5 |

**3. 粘贴 API Key**：把第 3 步复制的 Key 粘到 `apiKey` 字段。

**4. 选择模型**：从下拉里选一个（推荐 `GLM-4.6`）。如果你订阅的是更新的套餐（如想用 GLM-5.2 / GLM-5-Turbo），可手动在模型字段里填写控制台显示的模型 ID。

**5. 保存**：点击保存，应该会看到「已生效」或类似提示。

![inkpress 设置页，AI 大模型配置截图，配置 baseUrl、api-key 和模型名称等](/guide-images/2026-07-05/b1d971fb-58eb-4e15-9663-77ada7abc9a9.png)

> 💡 **不要手动改 baseUrl**。InkPress 走 Anthropic 协议，必须填 `https://open.bigmodel.cn/api/anthropic`；如果你看到设置页对当前供应商显示**橙色警告**，多半是历史遗留配置指向了 OpenAI 端点（`/api/coding/paas/v4`），按提示改成 GLM 预设即可。

---

## 六、第 5 步：验证连通

**前置条件**：第 4 步已保存。

回到 InkPress 主界面对话框，发一条最简单的消息：

```
你好，请用一句话介绍你自己。
```

**预期结果**：几秒内收到 GLM 的回复，说明端点、Key、模型都通了。

**如果出错**：先看错误提示里的状态码，对照文末「常见坑」排查。

---

## 七、协议端点对照表（重要）

InkPress 主链路 Claude Agent 只能走 **Anthropic /messages 协议**，所以 GLM 必须填下表的第一个端点。OpenAI 端点只在你接入其他工具（如 Cursor、Cline、自研脚本）时才会用到，不要填到 InkPress 里。

| 协议 | 端点 | 用途 |
|---|---|---|
| **Anthropic Message** | `https://open.bigmodel.cn/api/anthropic` | ✅ **InkPress 用这个**（Claude Agent SDK 走的就是它）|
| OpenAI Chat Completion | `https://open.bigmodel.cn/api/coding/paas/v4` | 仅用于其他 OpenAI 兼容客户端，不要填进 InkPress |

---

## 八、其他模型的申请入口

如果你不想用 GLM，下面是其他常见模型的申请入口和配置思路。**所有第三方模型都必须支持 Anthropic 协议**才能接进 InkPress；只支持 OpenAI 协议的，请通过 OpenRouter 中转。

| 模型 | 申请 / 控制台入口 | 备注 |
|---|---|---|
| **MiniMax**（M 系列） | [https://platform.

minimaxi.

com](https://platform.

minimaxi.

com) | 国内性价比之一；如官方未提供 Anthropic 兼容端点，走 OpenRouter 中转 |
| **Kimi**（月之暗面 K 系列） | [https://platform.

moonshot.

cn](https://platform.

moonshot.

cn) | 长上下文表现好；同样推荐先确认是否提供 Anthropic 端点 |
| **OpenRouter**（多模型聚合） | [https://openrouter.

ai/keys](https://openrouter.

ai/keys) | **强烈推荐作为备选**：一个 Key 调用 Claude / GLM / Gemini 等几十种模型，InkPress 已内置预设（`baseUrl = https://openrouter.

ai/api/v1`）|
| **Anthropic 官方** | [https://console.

anthropic.

com/settings/keys](https://console.

anthropic.

com/settings/keys) | 海外信用卡；能力最强但成本最高 |
| **DeepSeek** | [https://platform.

deepseek.

com](https://platform.

deepseek.

com) | 通常需走 OpenRouter 才能接 InkPress |

> 配置方法与 GLM 完全一致：在 InkPress 设置页选对应预设（或手填 baseUrl），粘贴 API Key，选模型，保存。

---

## 九、常见坑 / 故障排查

| 现象 | 原因 | 解决 |
|---|---|---|
| 调用报 401 / 403 | API Key 错误、过期或没权限 | 重新去 [apikey/platform](https://bigmodel.

cn/apikey/platform) 复制；检查是否多余空格/换行 |
| 报 404 / 路径错误 | baseUrl 填成了 OpenAI 端点 `/api/coding/paas/v4` | 改回 `https://open.

bigmodel.

cn/api/anthropic`，或直接选「智谱 GLM」预设 |
| 设置页出现橙色警告 | 历史遗留的 openai-compatible 配置 | 改用 Anthropic 预设；旧 baseUrl 不再生效 |
| 调用很慢或频繁 429 | 触达 5 小时 / 每周限额，或赶上了高峰期（每日 14:00–18:00 UTC+8）| 等下一周期刷新；或升级到 Pro / Max；GLM-5.

2 高峰期会按 3 倍消耗额度 |
| 切换模型后对话"失忆" | InkPress 检测到模型变化会强制开启新的 Agent 会话 | 这是正常行为；要继续同一篇内容，把上一段上下文复制到新会话即可 |
| 模型 ID 不识别 | 手填了 GLM-5.

2 等新模型，但 ID 大小写或拼写不对 | 以 [BigModel 控制台](https://bigmodel.

cn) 显示的模型 ID 为准 |
| 套餐提示额度未扣 | Coding Plan 仅官方指定工具享套餐额度，第三方客户端可能走 API 余额 | 准备一份按量计费余额兜底；或先咨询官方确认 |

---

## 十、小结

整条链路其实就是三件事：**在 BigModel 拿到 Key → 在 InkPress 选 GLM 预设 → 粘贴 Key 并保存**。预设自动填好了 baseUrl，你不用纠结协议端点；剩下的就是套餐选型——先用免费额度跑通，再按实际消耗决定是否升级。

如果你还想接 MiniMax、Kimi 或直接用 Claude 官方，参考第八节入口；配置步骤与 GLM 完全相同，只是 baseUrl 和 Key 不同。

> 数据来源：智谱官方 [GLM Coding Plan 套餐概览](https://docs.bigmodel.cn/cn/coding-plan/overview)、[产品价格页](https://bigmodel.cn/pricing)；InkPress 内置预设文件 `src/data/llm-presets.json`。
