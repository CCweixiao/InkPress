// Next.js 16 移除了 `next lint`，改为直接用 ESLint 9+ 跑（flat config）。
// eslint-config-next@16 改为子路径 ESM 导出：core-web-vitals / typescript。
import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  // 全局忽略：生成物 / 构建产物 / 辅助目录
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "src/generated/**", // Prisma 生成代码（含整文件 eslint-disable，~50 条 any 噪声）
    "dist/**",
    "dist-electron/**",
    "electron/**", // 独立 tsconfig
    "graphify-out/**",
    "dev.database/**",
    "storage/**",
    "logs/**",
    ".inkpress/**",
    "scripts/**",
    "tests/**",
    "prisma/**",
    "public/**",
    "themes/**",
    "resources/**",
    "docs/**",
    "**/*.config.{js,mjs,ts}",
  ]),

  ...nextVitals, // Next + react + react-hooks 规则（core-web-vitals）
  ...nextTs, // @typescript-eslint/recommended

  // warn-first：存量来源降级为 warning，保证 `eslint .` exit 0 不阻断，后续逐文件清理。
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      "react-hooks/exhaustive-deps": "warn",
      // 以下三条是 eslint-plugin-react-hooks v7（被 eslint-config-next@16 带入）的新规则，
      // 对成熟模式（SSR mounted、effect 内 setState 等）大量误报，先降为 warn 不阻断。
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/preserve-manual-memoization": "warn",
      "react-hooks/immutability": "warn",
      "@next/next/no-img-element": "warn",
    },
  },
]);

export default eslintConfig;
