// Phase 3 客户端 License API 端到端冒烟（mock 客户端）。
// 用法：node scripts/smoke/v1-license-smoke.mjs [BASE] [ADMIN_PASSWORD]
//   BASE 默认 http://localhost:3001；ADMIN_PASSWORD 默认 Test1234（本地 dev.db）
//
// 覆盖：admin 建 key → activate（含幂等）→ validate（HMAC+nonce）→ 重放 → 签名错
//       → 设备超限 → 设备不匹配 → deactivate → 再激活 → 校验日志/加密存储核查。
import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import Database from "better-sqlite3";

const BASE = process.argv[2] ?? "http://localhost:3001";
const ADMIN_PASSWORD = process.argv[3] ?? "Test1234";
const ADMIN_EMAIL = "admin@example.com";

let failures = 0;
function assert(cond, msg) {
  if (!cond) {
    console.error("✗", msg);
    failures++;
  }
}
const sha256 = (s) => createHash("sha256").update(s).digest("hex");

// ---- HTTP + cookie jar ----
const jar = new Map();
function capture(res) {
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const [pair] = c.split(";");
    const [k, ...v] = pair.split("=");
    jar.set(k.trim(), v.join("=").trim());
  }
}
const cookie = () => [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");

// ---- 签名工具（与服务端 request-signature.ts 对齐） ----
function signRequest(secret, method, path, ts, nonce, bodyHash) {
  const canonical = [method.toUpperCase(), path, ts, nonce, bodyHash].join("\n");
  return createHmac("sha256", secret).update(canonical).digest("hex");
}
function signedPost(pathRel, secret, bodyObj, { nonce, ts, mutateSignature } = {}) {
  const path = `/api/v1/licenses/${pathRel}`;
  const bodyStr = JSON.stringify(bodyObj);
  const bodyHash = sha256(bodyStr);
  const _ts = ts ?? String(Math.floor(Date.now() / 1000));
  const _nonce = nonce ?? randomBytes(16).toString("hex");
  let signature = signRequest(secret, "POST", path, _ts, _nonce, bodyHash);
  if (mutateSignature) signature = "0".repeat(64);
  return fetch(`${BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-InkPress-Client-Id": randomUUID(),
      "X-InkPress-Device-Id": bodyObj.deviceIdHash,
      "X-InkPress-Timestamp": _ts,
      "X-InkPress-Nonce": _nonce,
      "X-InkPress-Signature": signature,
    },
    body: bodyStr,
  });
}

// ---- 设备指纹 ----
const dev = (seed) => ({
  deviceIdHash: sha256("device-" + seed),
  machineIdHash: sha256("machine-" + seed),
  macHash: sha256("mac-" + seed),
  hostnameHash: sha256("host-" + seed),
  os: "darwin",
  arch: "arm64",
});
const device1 = dev("1");
const device2 = dev("2");
const device3 = dev("3");

// ============ 1) admin 登录 ============
let res = await fetch(`${BASE}/api/auth/csrf`);
capture(res);
const { csrfToken } = await res.json();
assert(csrfToken, "未取到 csrfToken");

res = await fetch(`${BASE}/api/auth/callback/credentials`, {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded", cookie: cookie() },
  body: new URLSearchParams({
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
    csrfToken,
    callbackUrl: "/admin",
    json: "true",
  }).toString(),
  redirect: "manual",
});
capture(res);
assert([...jar.keys()].some((k) => k.includes("session")), "admin 登录未下发 session");

// ============ 2) 建 License（maxDevices=2） ============
res = await fetch(`${BASE}/api/admin/licenses`, {
  method: "POST",
  headers: { "Content-Type": "application/json", cookie: cookie() },
  body: JSON.stringify({ durationKind: "YEAR_1", maxDevices: 2, note: "phase3-smoke" }),
});
const created = await res.json();
assert(created.ok && created.data.licenseKey.startsWith("INKP-"), "建 License 失败");
const LICENSE_KEY = created.data.licenseKey;
const LICENSE_ID = created.data.id;
console.log("✓ 建 License:", LICENSE_KEY, "maxDevices=2");

// ============ 3) activate device1 ============
res = await fetch(`${BASE}/api/v1/licenses/activate`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ licenseKey: LICENSE_KEY, device: device1, app: { version: "1.0.0", channel: "stable" } }),
});
const act1 = await res.json();
assert(res.status === 201, `activate 期望 201，实际 ${res.status}`);
assert(act1.ok && act1.data.status === "ACTIVE", "activate 状态非 ACTIVE");
assert(typeof act1.data.licenseToken === "string" && act1.data.licenseToken.includes("."), "licenseToken 形态异常");
assert(typeof act1.data.activationSecret === "string" && act1.data.activationSecret.length > 16, "activationSecret 缺失");
assert(act1.data.activatedDevices === 1, `activatedDevices 期望 1，实际 ${act1.data.activatedDevices}`);
const ACT1 = act1.data.activationId;
const SECRET1 = act1.data.activationSecret;
console.log("✓ activate device1:", ACT1);

// ============ 4) 幂等重激活 device1 ============
res = await fetch(`${BASE}/api/v1/licenses/activate`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ licenseKey: LICENSE_KEY, device: device1, app: { version: "1.0.0" } }),
});
const act1b = await res.json();
assert(act1b.data.activationId === ACT1, "幂等重激活 activationId 不一致");
console.log("✓ 幂等重激活同 activationId");

// ============ 5) validate device1（HMAC+nonce） ============
res = await signedPost("validate", SECRET1, {
  activationId: ACT1,
  deviceIdHash: device1.deviceIdHash,
  appVersion: "1.0.0",
});
const val1 = await res.json();
assert(res.status === 200 && val1.data.status === "ACTIVE", `validate 期望 ACTIVE，实际 ${res.status} ${val1?.data?.status}`);
assert(typeof val1.data.licenseToken === "string", "validate 未重签 token");
assert(val1.data.offlineGraceSeconds === 259200, "offlineGraceSeconds 非 72h");
console.log("✓ validate device1 → ACTIVE，新 token 已签");

// ============ 6) 重放同一 nonce → REPLAY_DETECTED ============
const reusedNonce = randomBytes(16).toString("hex");
await signedPost("validate", SECRET1, { activationId: ACT1, deviceIdHash: device1.deviceIdHash, appVersion: "1.0.0" }, { nonce: reusedNonce });
res = await signedPost("validate", SECRET1, { activationId: ACT1, deviceIdHash: device1.deviceIdHash, appVersion: "1.0.0" }, { nonce: reusedNonce });
assert(res.status === 401 && (await res.json()).error?.code === "REPLAY_DETECTED", `重放期望 401 REPLAY_DETECTED，实际 ${res.status}`);
console.log("✓ 重放被拒 REPLAY_DETECTED");

// ============ 7) 签名错误 → SIGNATURE_INVALID ============
res = await signedPost("validate", SECRET1, { activationId: ACT1, deviceIdHash: device1.deviceIdHash, appVersion: "1.0.0" }, { mutateSignature: true });
assert(res.status === 401 && (await res.json()).error?.code === "SIGNATURE_INVALID", `签名错期望 401 SIGNATURE_INVALID，实际 ${res.status}`);
console.log("✓ 签名错误被拒 SIGNATURE_INVALID");

// ============ 8) activate device2（第二台） ============
res = await fetch(`${BASE}/api/v1/licenses/activate`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ licenseKey: LICENSE_KEY, device: device2, app: { version: "1.0.0" } }),
});
const act2 = await res.json();
assert(res.status === 201 && act2.data.activatedDevices === 2, `device2 激活期望 201/2 台，实际 ${res.status}/${act2.data?.activatedDevices}`);
const SECRET2 = act2.data.activationSecret;
console.log("✓ activate device2（2/2）");

// ============ 9) activate device3 → DEVICE_LIMIT_EXCEEDED ============
res = await fetch(`${BASE}/api/v1/licenses/activate`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ licenseKey: LICENSE_KEY, device: device3, app: { version: "1.0.0" } }),
});
const act3 = await res.json();
assert(res.status === 409 && act3.error?.code === "DEVICE_LIMIT_EXCEEDED", `device3 期望 409 DEVICE_LIMIT_EXCEEDED，实际 ${res.status}`);
console.log("✓ 第三台被拒 DEVICE_LIMIT_EXCEEDED");

// ============ 10) 设备不匹配：device2 secret 声称 device1 ============
res = await signedPost("validate", SECRET2, { activationId: act2.data.activationId, deviceIdHash: device1.deviceIdHash, appVersion: "1.0.0" });
const mm = await res.json();
assert(res.status === 200 && mm.data.status === "DEVICE_MISMATCH", `设备不匹配期望 DEVICE_MISMATCH，实际 ${mm?.data?.status}`);
console.log("✓ 设备不匹配 → DEVICE_MISMATCH");

// ============ 11) deactivate device1 ============
res = await signedPost("deactivate", SECRET1, { activationId: ACT1, deviceIdHash: device1.deviceIdHash });
const deact = await res.json();
assert(res.status === 200 && deact.data.status === "DEACTIVATED", `deactivate 期望 200 DEACTIVATED，实际 ${res.status}`);
console.log("✓ deactivate device1");

// ============ 12) device1 再 validate → DEVICE_MISMATCH（已解绑） ============
res = await signedPost("validate", SECRET1, { activationId: ACT1, deviceIdHash: device1.deviceIdHash, appVersion: "1.0.0" });
const valAfter = await res.json();
assert(res.status === 200 && valAfter.data.status === "DEVICE_MISMATCH", `解绑后 validate 期望 DEVICE_MISMATCH，实际 ${valAfter?.data?.status}`);
console.log("✓ 解绑后 validate → DEVICE_MISMATCH");

// ============ 13) device1 再激活（槽位已释放） ============
res = await fetch(`${BASE}/api/v1/licenses/activate`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ licenseKey: LICENSE_KEY, device: device1, app: { version: "1.0.0" } }),
});
const react = await res.json();
assert(res.status === 201 && react.data.activationId === ACT1, `再激活期望 201 同 activationId，实际 ${res.status}`);
console.log("✓ device1 再激活成功（槽位释放）");

// ============ 14) DB 核查：日志齐全 + 密文存储非明文 ============
const db = new Database("dev.db", { readonly: true });
const logs = db.prepare("SELECT action, result FROM LicenseValidationLog WHERE licenseKeyId = ?").all(LICENSE_ID);
const actions = new Set(logs.map((l) => l.action));
assert(actions.has("ACTIVATE") && actions.has("VALIDATE") && actions.has("DEACTIVATE"), `校验日志缺少动作，现有 ${[...actions]}`);
const denied = logs.filter((l) => l.result === "DENIED").length;
assert(denied >= 1, "期望至少 1 条 DENIED 日志");
const enc = db.prepare("SELECT activationSecretEnc, activationSecretHash FROM LicenseActivation WHERE id = ?").get(ACT1);
assert(enc?.activationSecretEnc && enc.activationSecretEnc.length > 24, "activationSecretEnc 为空");
assert(!enc.activationSecretEnc.includes(SECRET1), "密文含明文 secret（泄漏！）");
assert(enc.activationSecretHash === sha256(SECRET1), "activationSecretHash 非 sha256(secret)");
console.log(`✓ DB 核查：日志 ${logs.length} 条（含 DENIED ${denied}），密文存储非明文`);

// ============ 汇总 ============
if (failures === 0) {
  console.log("\n✅ ALL PHASE 3 SMOKE TESTS PASSED");
  process.exit(0);
} else {
  console.error(`\n❌ ${failures} 项断言失败`);
  process.exit(1);
}
