import { rmSync } from "node:fs";
import { afterAll, describe, expect, it, vi } from "vitest";

// 仅隔离 .secret：把 inkpressHomeDir() 指向独立临时目录。
// 不设 INKPRESS_HOME（那会连带重定向 logger 文件输出，afterAll 删除时与 sonic-boom 竞态报 ENOENT）；
// logger 仍用 dataHome()（dev=null→项目 logs），互不干扰。
const { tmpHome } = vi.hoisted(() => {
  // hoisted 回调在 import 之前执行；用 require 取 node 内建。
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require("node:fs") as typeof import("node:fs");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const os = require("node:os") as typeof import("node:os");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require("node:path") as typeof import("node:path");
  return { tmpHome: fs.mkdtempSync(path.join(os.tmpdir(), "inkpress-secret-")) };
});

vi.mock("@/lib/paths", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/paths")>();
  return { ...actual, inkpressHomeDir: () => tmpHome };
});

// 在 mock 生效后静态导入（secret-store 顶层用 inkpressHomeDir() 计算 .secret 路径）。
const { encryptSecret, decryptSecret, isEncryptedSecret } = await import(
  "../../src/lib/crypto/secret-store"
);

afterAll(() => {
  try {
    rmSync(tmpHome, { recursive: true, force: true });
  } catch {
    /* 忽略 */
  }
});

describe("secret-store (B7)", () => {
  it("round-trip：加密后可解密回原文，密文与明文不同", () => {
    const plain = "sk-ant-test-12345";
    const enc = encryptSecret(plain);
    expect(enc).not.toBe(plain);
    expect(isEncryptedSecret(enc)).toBe(true);
    expect(decryptSecret(enc)).toBe(plain);
  });

  it("幂等：对已加密值再次 encrypt 直通，不二次套娃", () => {
    const enc = encryptSecret("sk-x");
    expect(encryptSecret(enc)).toBe(enc);
  });

  it("惰性迁移：旧明文（非 v1: 前缀）decrypt 直通", () => {
    expect(decryptSecret("sk-legacy")).toBe("sk-legacy");
    expect(isEncryptedSecret("sk-legacy")).toBe(false);
  });

  it("空串保持空串", () => {
    expect(encryptSecret("")).toBe("");
    expect(decryptSecret("")).toBe("");
  });

  it("信封损坏（GCM 校验失败）返回空串而非抛错", () => {
    const enc = encryptSecret("sk-y");
    // 篡改密文段（最后一段 base64）→ GCM authTag 校验失败
    const parts = enc.split(":");
    const tampered =
      parts.slice(0, -1).join(":") +
      ":" +
      Buffer.from("tampered-ciphertext").toString("base64");
    expect(decryptSecret(tampered)).toBe("");
  });
});
