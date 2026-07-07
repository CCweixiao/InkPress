// 探测脚本：用 Claude Agent SDK 直接打一次 GLM (BigModel /anthropic) 端点，
// 打印收到的 SDKMessage 序列，验证流式兼容性（de-risk）。
//
// 凭据来源（优先级）：环境变量 ANTHROPIC_BASE_URL / ANTHROPIC_AUTH_TOKEN / MODEL
// → 否则读 dev.db 里设置页保存的 inkpress.claude-agent 配置。
//
// 用法：
//   pnpm tsx scripts/probe-claude-agent-sdk.mjs
//   ANTHROPIC_AUTH_TOKEN=sk-xxx pnpm tsx scripts/probe-claude-agent-sdk.mjs

import Database from "better-sqlite3";
import { query } from "@anthropic-ai/claude-agent-sdk";
import fs from "node:fs";
import path from "node:path";

const DEFAULT_CFG = {
  baseUrl: "https://open.bigmodel.cn/api/anthropic",
  apiKey: "",
  model: "glm-4.6",
};

function readConfigFromDb() {
  const dbPath = path.resolve("dev.db");
  if (!fs.existsSync(dbPath)) return {};
  try {
    const db = new Database(dbPath, { readonly: true });
    const row = db
      .prepare("SELECT value FROM SystemConfig WHERE key = ?")
      .get("inkpress.claude-agent");
    db.close();
    if (row?.value) return JSON.parse(row.value);
  } catch {
    // 忽略读取失败
  }
  return {};
}

const dbCfg = readConfigFromDb();
const baseUrl = process.env.ANTHROPIC_BASE_URL || dbCfg.baseUrl || DEFAULT_CFG.baseUrl;
const apiKey =
  process.env.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_API_KEY || dbCfg.apiKey || "";
const model = process.env.MODEL || dbCfg.model || DEFAULT_CFG.model;

if (!apiKey) {
  console.error(
    "[probe] 缺少 API Key：请在设置页「写作 Agent → Claude Agent 后端」填入后保存，或用 ANTHROPIC_AUTH_TOKEN 环境变量。"
  );
  process.exit(1);
}

console.log("[probe] backend =", baseUrl);
console.log("[probe] model   =", model);
console.log("[probe] key     =", `${apiKey.slice(0, 6)}…(${apiKey.length} chars)`);
console.log("----");

const ac = new AbortController();
const options = {
  env: {
    ...process.env,
    ANTHROPIC_BASE_URL: baseUrl,
    ANTHROPIC_AUTH_TOKEN: apiKey,
    ANTHROPIC_API_KEY: undefined,
  },
  model,
  systemPrompt: "你是测试助手，用一句简洁的中文回答。",
  tools: [],
  allowedTools: [],
  settingSources: [],
  persistSession: false,
  includePartialMessages: true,
  abortController: ac,
  stderr: (data) => process.stderr.write(`[sdk stderr] ${data}`),
  maxTurns: 1,
};

let count = 0;
try {
  for await (const message of query({ prompt: "说一句你好", options })) {
    count += 1;
    const t = message.type;
    if (t === "stream_event") {
      const ev = message.event;
      const detail =
        ev.type === "content_block_delta"
          ? JSON.stringify(ev.delta)
          : ev.type === "content_block_start"
            ? `block.type=${ev.content_block?.type}`
            : "";
      console.log(`#${count} stream_event ${ev.type} ${detail}`);
    } else if (t === "assistant") {
      const blocks = (message.message?.content ?? []).map((b) => ({
        type: b.type,
        preview: typeof b.text === "string" ? b.text.slice(0, 60) : undefined,
      }));
      console.log(`#${count} assistant`, JSON.stringify(blocks));
    } else if (t === "result") {
      console.log(
        `#${count} result subtype=${message.subtype} is_error=${message.is_error} usage=${JSON.stringify(message.usage)} session=${message.session_id}`
      );
      if (message.subtype !== "success") {
        console.log("    errors:", message.errors?.join("; ") || message.result);
      }
    } else {
      console.log(`#${count} ${t}`);
    }
  }
  console.log(`----\n[probe] 完成，共 ${count} 条消息。`);
} catch (err) {
  console.error("[probe] 失败：", err);
  process.exit(1);
}
