/**
 * 轻量 semver 比较：支持 `x.y.z` 和 `x.y.z-prerelease`。
 *
 * 不引入 semver 依赖，只处理本项目用到的格式（release.mjs 产物为纯 `x.y.z`）。
 * prerelease 规则遵循 semver：`1.0.0-beta.1 < 1.0.0`。
 *
 * 解析失败时回退为字符串字典序比较，保证全序（不会返回 0）。
 */

export type ParsedVersion = {
  major: number;
  minor: number;
  patch: number;
  /** 不含前导 `-`/`+`；无则空数组 */
  prerelease: string[];
};

const NUM_RE = /^\d+$/;

/**
 * 解析 semver 字符串为可比较的结构。
 * 接受可选的 `v` 前缀；忽略 build metadata（`+xxx`）。
 */
export function parseVersion(raw: string): ParsedVersion | null {
  const input = raw.trim().replace(/^v/, "");
  const mainAndMeta = input.split("+", 1)[0];
  const [mainPart, ...preParts] = mainAndMeta.split("-");
  const prereleaseStr = preParts.length > 0 ? preParts.join("-") : "";
  const segments = mainPart.split(".");
  if (segments.length < 3) return null;

  const major = Number(segments[0]);
  const minor = Number(segments[1]);
  const patch = Number(segments[2]);
  if (![major, minor, patch].every((n) => NUM_RE.test(String(n)) && n >= 0)) {
    return null;
  }

  const prerelease = prereleaseStr ? prereleaseStr.split(".") : [];
  return { major, minor, patch, prerelease };
}

/**
 * 比较两个版本号。
 *
 * @returns -1 if a < b；0 if a == b；1 if a > b
 *          解析失败时按字符串字典序回退（互异时不会返回 0）
 */
export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) {
    if (a === b) return 0;
    return a < b ? -1 : 1;
  }

  // 主版本号
  if (pa.major !== pb.major) return pa.major < pb.major ? -1 : 1;
  if (pa.minor !== pb.minor) return pa.minor < pb.minor ? -1 : 1;
  if (pa.patch !== pb.patch) return pa.patch < pb.patch ? -1 : 1;

  // prerelease：无 prerelease > 有 prerelease（1.0.0 > 1.0.0-beta）
  const aHasPre = pa.prerelease.length > 0;
  const bHasPre = pb.prerelease.length > 0;
  if (!aHasPre && bHasPre) return 1;
  if (aHasPre && !bHasPre) return -1;
  if (!aHasPre && !bHasPre) return 0;

  // 双方都有 prerelease：逐段比较（数字段比数值，非数字段比字典序，数字段 < 非数字段）
  const len = Math.min(pa.prerelease.length, pb.prerelease.length);
  for (let i = 0; i < len; i++) {
    const ax = pa.prerelease[i]!;
    const bx = pb.prerelease[i]!;
    const aNum = NUM_RE.test(ax);
    const bNum = NUM_RE.test(bx);
    if (aNum && bNum) {
      const an = Number(ax);
      const bn = Number(bx);
      if (an !== bn) return an < bn ? -1 : 1;
    } else if (aNum && !bNum) {
      return -1;
    } else if (!aNum && bNum) {
      return 1;
    } else {
      if (ax !== bx) return ax < bx ? -1 : 1;
    }
  }
  // 公共前缀相同时，prerelease 段数多的更「新」（beta.1.2 > beta.1）
  if (pa.prerelease.length !== pb.prerelease.length) {
    return pa.prerelease.length < pb.prerelease.length ? -1 : 1;
  }
  return 0;
}

/** latest 是否严格大于 current（用于判断"是否有新版本"） */
export function isVersionNewer(latest: string, current: string): boolean {
  return compareVersions(latest, current) === 1;
}
