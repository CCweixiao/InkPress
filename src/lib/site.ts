/**
 * 站点级常量：版本号、仓库地址、Release 链接。
 * 版本号以 package.json 为唯一来源（tsconfig 已开启 resolveJsonModule）。
 */
import pkg from "@/../package.json";

export const APP_VERSION: string = pkg.version;

/** GitHub 仓库地址（与 git remote origin 保持一致） */
export const REPO_URL = "https://github.com/CCweixiao/InkPress";

/** Issues 链接 */
export const ISSUES_URL = `${REPO_URL}/issues`;

/** Releases 列表 */
export const RELEASES_URL = `${REPO_URL}/releases`;

/**
 * 指定版本对应的 Release Tag 页面。
 * 自动补全 `v` 前缀（与 release.yml 的 `v*` tag 触发规则一致）。
 */
export function releaseTagUrl(version: string = APP_VERSION): string {
  const v = version.startsWith("v") ? version : `v${version}`;
  return `${REPO_URL}/releases/tag/${v}`;
}
