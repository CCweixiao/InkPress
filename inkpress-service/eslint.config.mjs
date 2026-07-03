// eslint-config-next 16 已原生导出 flat config 数组，直接展开即可，
// 无需 FlatCompat（经 @eslint/eslintrc 兼容层会触发 circular JSON 报错）。
import nextConfig from "eslint-config-next";

const eslintConfig = [
  ...nextConfig,
  {
    ignores: [".next/**", "node_modules/**", "src/generated/**", "build/**"],
  },
];

export default eslintConfig;
