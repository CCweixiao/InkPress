// 探测限流重试逻辑（真实函数）：isRateLimitError 判定 + retryOnRateLimit 的
// 重试/用尽/sleep 中止/非限流立即抛 四种语义。用小 waitMs + mock runOnce，快速确定性验证。
//
//   pnpm tsx scripts/probe-rate-limit.ts
import { isRateLimitError } from "../src/lib/ai/error-classify";
import { retryOnRateLimit } from "../src/lib/ai/claude-agent-runtime";

function rl(m: string) {
  return isRateLimitError(new Error(m));
}

async function caseA() {
  // 限流 2 次后第 3 次成功
  let calls = 0;
  const retries: number[] = [];
  const r = await retryOnRateLimit(
    async () => {
      calls += 1;
      if (calls < 3) throw new Error("访问量过大，请稍后再试");
      return "ok";
    },
    { onRetry: (a) => retries.push(a), maxRetries: 5, waitMs: 15 }
  );
  console.log(
    "[A] 重试2次后成功 →",
    r === "ok" && calls === 3 && retries.length === 2 ? "✅" : "❌",
    "| calls=", calls, "retries=", retries.join(",")
  );
}

async function caseB() {
  // 一直限流 → 重试用尽上抛
  let calls = 0;
  const retries: number[] = [];
  let threw = false;
  try {
    await retryOnRateLimit(
      async () => {
        calls += 1;
        throw new Error("429 Too Many Requests");
      },
      { onRetry: (a) => retries.push(a), maxRetries: 3, waitMs: 10 }
    );
  } catch {
    threw = true;
  }
  console.log(
    "[B] 重试用尽(3) →",
    threw && calls === 4 && retries.length === 3 ? "✅" : "❌",
    "| calls=", calls, "(期望 4=1 初始+3 重试)"
  );
}

async function caseC() {
  // sleep 期间用户中止 → 抛 AbortError
  const ac = new AbortController();
  let calls = 0;
  let threw = false;
  let isAbort = false;
  setTimeout(() => ac.abort(), 30);
  try {
    await retryOnRateLimit(
      async () => {
        calls += 1;
        throw new Error("访问量过大");
      },
      { signal: ac.signal, onRetry: () => undefined, maxRetries: 5, waitMs: 2000 }
    );
  } catch (e) {
    threw = true;
    isAbort = e instanceof Error && e.name === "AbortError";
  }
  console.log(
    "[C] sleep 中中止 →",
    threw && isAbort && calls === 1 ? "✅" : "❌",
    "| calls=", calls, "isAbort=", isAbort
  );
}

async function caseD() {
  // 非限流错误 → 立即抛，不重试
  let calls = 0;
  let threw = false;
  try {
    await retryOnRateLimit(
      async () => {
        calls += 1;
        throw new Error("连接超时 / timeout");
      },
      { onRetry: () => undefined, maxRetries: 5, waitMs: 10 }
    );
  } catch {
    threw = true;
  }
  console.log(
    "[D] 非限流立即抛 →",
    threw && calls === 1 ? "✅" : "❌",
    "| calls=", calls
  );
}

async function main() {
  console.log("[isRateLimit] 访问量过大 →", rl("访问量过大，请稍后再试") ? "✅" : "❌");
  console.log("[isRateLimit] 429 文案 →", rl("Request rate limit exceeded (429)") ? "✅" : "❌");
  console.log("[isRateLimit] 429 statusCode →", isRateLimitError(Object.assign(new Error("x"), { statusCode: 429 })) ? "✅" : "❌");
  console.log("[isRateLimit] Bad credentials(应false) →", rl("GitHub：Bad credentials") ? "❌" : "✅");
  console.log("[isRateLimit] 超时(应false) →", rl("请求超时") ? "❌" : "✅");
  await caseA();
  await caseB();
  await caseC();
  await caseD();
}
main().catch((e) => {
  console.error("[probe] 失败:", e);
  process.exit(1);
});
