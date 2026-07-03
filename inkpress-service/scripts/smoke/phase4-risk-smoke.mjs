// Phase 4 异常风控冒烟：失败激活累计超阈值 → IP 被封禁，正确 key 也被拒。
// 用法：node scripts/smoke/phase4-risk-smoke.mjs [BASE] [ADMIN_PASSWORD] [THRESHOLD]
//   BASE 默认 http://localhost:3001；ADMIN_PASSWORD 默认 Test1234；THRESHOLD 默认 5
//   （需以 RISK_ACTIVATION_FAIL_THRESHOLD=<同值> 启动 dev）
import { createHash } from "node:crypto";
import Database from "better-sqlite3";

const BASE = process.argv[2] ?? "http://localhost:3001";
const ADMIN_PASSWORD = process.argv[3] ?? "Test1234";
const THRESHOLD = Number(process.argv[4] ?? 5);
const TEST_IP = "198.51.100.42"; // TEST-NET-2，固定探测来源
const ADMIN_EMAIL = "admin@example.com";

const sha = (s) => createHash("sha256").update(s).digest("hex");

let failures = 0;
function assert(cond, msg) {
  if (!cond) {
    console.error("✗", msg);
    failures++;
  }
}
const headers = (extra = {}) => ({
  "Content-Type": "application/json",
  "X-Forwarded-For": TEST_IP,
  ...extra,
});

// ---- admin 登录建 key ----
const jar = new Map();
function capture(res) {
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const [pair] = c.split(";");
    const [k, ...v] = pair.split("=");
    jar.set(k.trim(), v.join("=").trim());
  }
}
const cookie = () => [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");

let res = await fetch(`${BASE}/api/auth/csrf`);
capture(res);
const { csrfToken } = await res.json();
res = await fetch(`${BASE}/api/auth/callback/credentials`, {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded", cookie: cookie() },
  body: new URLSearchParams({
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
    csrfToken,
    callbackUrl: "/admin",
    json: "true",
  }),
  redirect: "manual",
});
capture(res);

res = await fetch(`${BASE}/api/admin/licenses`, {
  method: "POST",
  headers: { "Content-Type": "application/json", cookie: cookie() },
  body: JSON.stringify({ durationKind: "YEAR_1", maxDevices: 5, note: "phase4-risk" }),
});
const created = await res.json();
assert(created.ok, "建 License 失败");
const GOOD_KEY = created.data.licenseKey;
console.log("✓ 建 License:", GOOD_KEY);

const dev = (seed) => ({
  deviceIdHash: sha("dev-" + seed),
  machineIdHash: sha("mac-" + seed),
  os: "darwin",
  arch: "arm64",
});

// ---- THRESHOLD 次错误 key 激活（每次应返回模糊化 LICENSE_INVALID）----
for (let i = 1; i <= THRESHOLD; i++) {
  const r = await fetch(`${BASE}/api/v1/licenses/activate`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      licenseKey: "INKP-BADKEY-0000-00",
      device: dev("risk-" + i),
      app: { version: "1.0.0" },
    }),
  });
  const body = await r.json();
  assert(r.status === 400 && body.error?.code === "LICENSE_INVALID", `第 ${i} 次错误 key 期望 LICENSE_INVALID，实际 ${r.status} ${body.error?.code}`);
}
console.log(`✓ ${THRESHOLD} 次错误 key 激活均返回 LICENSE_INVALID`);

// ---- 此时 IP 应已被风控封禁：即便用正确 key 也被拒 RATE_LIMITED ----
const blocked = await fetch(`${BASE}/api/v1/licenses/activate`, {
  method: "POST",
  headers: headers(),
  body: JSON.stringify({
    licenseKey: GOOD_KEY,
    device: dev("good-after-block"),
    app: { version: "1.0.0" },
  }),
});
const blockedBody = await blocked.json();
assert(
  blocked.status === 429 && blockedBody.error?.code === "RATE_LIMITED",
  `封禁后正确 key 期望 429 RATE_LIMITED，实际 ${blocked.status} ${blockedBody.error?.code}`
);
console.log("✓ 封禁后正确 key 被风控拦截（RATE_LIMITED）");

// ---- DB 核查：存在 risk:blocked 审计记录 ----
const db = new Database("dev.db", { readonly: true });
const riskLogs = db
  .prepare("SELECT reason FROM LicenseValidationLog WHERE reason = ? AND ip = ?")
  .all("risk:blocked", TEST_IP);
assert(riskLogs.length >= 1, `期望 DB 有 risk:blocked 日志，实际 ${riskLogs.length} 条`);
console.log(`✓ DB 核查：risk:blocked 日志 ${riskLogs.length} 条（IP ${TEST_IP}）`);
db.close();

if (failures === 0) {
  console.log("\n✅ ALL PHASE 4 RISK SMOKE TESTS PASSED");
  process.exit(0);
} else {
  console.error(`\n❌ ${failures} 项断言失败`);
  process.exit(1);
}
