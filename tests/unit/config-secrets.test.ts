import { rmSync } from "node:fs";
import { afterAll, describe, expect, it, vi } from "vitest";

const { tmpHome } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require("node:fs") as typeof import("node:fs");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const os = require("node:os") as typeof import("node:os");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require("node:path") as typeof import("node:path");
  return { tmpHome: fs.mkdtempSync(path.join(os.tmpdir(), "inkpress-config-secrets-")) };
});

vi.mock("@/lib/paths", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/paths")>();
  return { ...actual, inkpressHomeDir: () => tmpHome };
});

const {
  decryptConfigValueForExport,
  decryptConfigValueForUse,
  encryptConfigValueForStorage,
} = await import("../../src/lib/config-secrets");

afterAll(() => {
  try {
    rmSync(tmpHome, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

describe("config-secrets", () => {
  it("encrypts and decrypts root-level config secrets", () => {
    const plain = JSON.stringify({
      tavilyApiKey: "tvly-secret",
      githubToken: "ghp-secret",
      maxSteps: 12,
      projects: [],
    });
    const stored = encryptConfigValueForStorage("inkpress.agent", plain);
    expect(stored).not.toContain("tvly-secret");
    expect(stored).not.toContain("ghp-secret");

    const runtime = decryptConfigValueForUse("inkpress.agent", stored);
    expect(JSON.parse(runtime ?? "{}")).toMatchObject({
      tavilyApiKey: "tvly-secret",
      githubToken: "ghp-secret",
    });
  });

  it("encrypts nested storage provider secrets", () => {
    const plain = JSON.stringify({
      defaultProvider: "aliyun-oss",
      providers: {
        local: { enabled: true },
        aliyunOss: {
          enabled: true,
          bucket: "b",
          domain: "https://cdn.example.com",
          accessKeyId: "ak",
          accessKeySecret: "oss-secret",
        },
      },
    });
    const stored = encryptConfigValueForStorage("inkpress.storage", plain);
    expect(stored).not.toContain("oss-secret");

    const exported = decryptConfigValueForExport("inkpress.storage", stored);
    expect(JSON.parse(exported).providers.aliyunOss.accessKeySecret).toBe(
      "oss-secret"
    );
  });

  it("keeps encryption idempotent for all configured fields", () => {
    const plain = JSON.stringify({ secret: "wechat-secret", appId: "wx" });
    const once = encryptConfigValueForStorage("inkpress.wechat", plain);
    const twice = encryptConfigValueForStorage("inkpress.wechat", once);
    expect(twice).toBe(once);
    expect(JSON.parse(decryptConfigValueForExport("inkpress.wechat", twice))).toEqual({
      secret: "wechat-secret",
      appId: "wx",
    });
  });
});
