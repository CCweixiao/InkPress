// 探测 githubRequest 的 token 策略（token-first + 401 匿名回退）。用 mock fetch 确定性验证，
// 不依赖真实 API / 不受匿名限流影响。
//
//   pnpm tsx scripts/probe-github-token.ts
import { githubRequest } from "../src/lib/ai/code-source";
import type { AgentConfig } from "../src/lib/ai/agent-config";

type Resp = { status: number; body: unknown };

function mockGithub(sequence: Resp[]) {
  const calls: { pathname: string; token?: string }[] = [];
  let i = 0;
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: string, init?: { headers?: Record<string, string> }) => {
    const pathname = String(url).replace("https://api.github.com", "");
    const auth = init?.headers?.Authorization;
    calls.push({ pathname, token: auth ? auth.replace("Bearer ", "") : undefined });
    const r = sequence[Math.min(i, sequence.length - 1)];
    i++;
    return new Response(JSON.stringify(r.body), {
      status: r.status,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  return {
    restore: () => {
      globalThis.fetch = original;
    },
    calls: () => calls,
  };
}

const cfg = (githubToken?: string): AgentConfig =>
  ({ githubToken }) as unknown as AgentConfig;

async function case1() {
  // 公开仓库 + 坏 token：token 401 → 匿名 200 → 成功
  const m = mockGithub([
    { status: 401, body: { message: "Bad credentials" } },
    { status: 200, body: { private: false, default_branch: "main" } },
  ]);
  try {
    const data = (await githubRequest("/repos/o/r", cfg("bad-token"))) as Record<string, unknown>;
    console.log("[case1] 公开+坏token →", data.private === false ? "✅ 成功（匿名回退）" : "❌", "| calls:", m.calls().length, "(期望 2)");
  } catch (e) {
    console.log("[case1] ❌ 抛错:", (e as Error).message);
  }
  m.restore();
}

async function case2() {
  // 公开仓库 + 无 token：匿名 200 → 成功
  const m = mockGithub([{ status: 200, body: { private: false, default_branch: "main" } }]);
  try {
    const data = (await githubRequest("/repos/o/r", cfg(undefined))) as Record<string, unknown>;
    console.log("[case2] 公开+无token →", data.private === false ? "✅ 成功" : "❌", "| calls:", m.calls().length, "(期望 1)");
  } catch (e) {
    console.log("[case2] ❌ 抛错:", (e as Error).message);
  }
  m.restore();
}

async function case3() {
  // 坏 token + 私有/不存在：token 401 → 匿名 404 → 清晰错误
  const m = mockGithub([
    { status: 401, body: { message: "Bad credentials" } },
    { status: 404, body: { message: "Not Found" } },
  ]);
  try {
    await githubRequest("/repos/o/r", cfg("bad-token"));
    console.log("[case3] ❌ 应抛错却成功");
  } catch (e) {
    const msg = (e as Error).message;
    console.log("[case3] 坏token+私有 →", msg.includes("Token 无效") ? "✅" : "⚠️", msg.slice(0, 70));
  }
  m.restore();
}

async function case4() {
  // 有效 token + 别人私有：token 404 → 无权访问
  const m = mockGithub([{ status: 404, body: { message: "Not Found" } }]);
  try {
    await githubRequest("/repos/o/r", cfg("valid-token"));
    console.log("[case4] ❌ 应抛错却成功");
  } catch (e) {
    const msg = (e as Error).message;
    console.log("[case4] 有效token+无权 →", msg.includes("无权访问") ? "✅" : "⚠️", msg.slice(0, 70));
  }
  m.restore();
}

async function case5() {
  // 有效 token + 自己私有：token 200 private:true → 成功
  const m = mockGithub([{ status: 200, body: { private: true, default_branch: "main" } }]);
  try {
    const data = (await githubRequest("/repos/o/r", cfg("valid-token"))) as Record<string, unknown>;
    console.log("[case5] 有效token+私有 →", data.private === true ? "✅ 成功（带 token）" : "❌", "| calls:", m.calls().length, "(期望 1)");
  } catch (e) {
    console.log("[case5] ❌ 抛错:", (e as Error).message);
  }
  m.restore();
}

async function main() {
  await case1();
  await case2();
  await case3();
  await case4();
  await case5();
}
main().catch((e) => console.error("[probe] 失败:", e));
