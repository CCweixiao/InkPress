import { normalizeDomain } from "@/lib/ai/web-allowlist";

export type WebUrlRiskLevel = "low" | "medium" | "high";

export type WebUrlRiskAssessment = {
  url: string;
  domain: string;
  isHttps: boolean;
  isKnownAuthority: boolean;
  isLikelyOfficial: boolean;
  isDeveloperSource: boolean;
  isRepositorySource: boolean;
  riskLevel: WebUrlRiskLevel;
  signals: string[];
  warnings: string[];
};

const KNOWN_AUTHORITY_DOMAINS = new Set([
  "anthropic.com",
  "openai.com",
  "github.com",
  "gitlab.com",
  "npmjs.com",
  "pypi.org",
  "python.org",
  "nodejs.org",
  "mozilla.org",
  "developer.mozilla.org",
  "microsoft.com",
  "learn.microsoft.com",
  "apple.com",
  "developers.google.com",
  "cloud.google.com",
  "aws.amazon.com",
  "docs.aws.amazon.com",
  "vercel.com",
  "nextjs.org",
  "react.dev",
  "typescriptlang.org",
]);

const OFFICIAL_HINTS = [
  "docs.",
  "developer.",
  "developers.",
  "learn.",
  "support.",
  "help.",
];

function hostMatchesKnownAuthority(domain: string): boolean {
  if (KNOWN_AUTHORITY_DOMAINS.has(domain)) return true;
  return Array.from(KNOWN_AUTHORITY_DOMAINS).some((known) =>
    domain.endsWith(`.${known}`)
  );
}

function hasOfficialHint(domain: string, pathname: string): boolean {
  return (
    OFFICIAL_HINTS.some((hint) => domain.startsWith(hint)) ||
    /\/(docs|documentation|developer|developers|learn|reference|api)(\/|$)/i.test(
      pathname
    )
  );
}

export function assessWebUrlRisk(input: string): WebUrlRiskAssessment {
  let url: URL | null = null;
  try {
    url = new URL(input);
  } catch {
    const domain = normalizeDomain(input);
    return {
      url: input,
      domain,
      isHttps: false,
      isKnownAuthority: false,
      isLikelyOfficial: false,
      isDeveloperSource: false,
      isRepositorySource: false,
      riskLevel: "high",
      signals: [],
      warnings: ["URL 格式无效，需谨慎授权"],
    };
  }

  const domain = normalizeDomain(url.hostname);
  const isHttps = url.protocol === "https:";
  const isKnownAuthority = hostMatchesKnownAuthority(domain);
  const isRepositorySource =
    domain === "github.com" || domain === "gitlab.com" || domain.endsWith(".github.com");
  const isDeveloperSource =
    hasOfficialHint(domain, url.pathname) ||
    isRepositorySource ||
    domain === "npmjs.com" ||
    domain === "pypi.org";
  const isLikelyOfficial = isKnownAuthority || isDeveloperSource;
  const signals: string[] = [];
  const warnings: string[] = [];

  if (isHttps) signals.push("HTTPS");
  else warnings.push("非 HTTPS");
  if (isKnownAuthority) signals.push("知名权威域名");
  if (isLikelyOfficial) signals.push("疑似官方/开发者来源");
  if (isRepositorySource) signals.push("代码仓库来源");
  if (!isLikelyOfficial) warnings.push("域名未在内置权威来源列表中");

  const riskLevel: WebUrlRiskLevel =
    !isHttps ? "high" : isLikelyOfficial ? "low" : "medium";

  return {
    url: url.toString(),
    domain,
    isHttps,
    isKnownAuthority,
    isLikelyOfficial,
    isDeveloperSource,
    isRepositorySource,
    riskLevel,
    signals,
    warnings,
  };
}

export function summarizeRiskForAllowlist(risk: WebUrlRiskAssessment): string {
  const bits = [
    risk.riskLevel === "low"
      ? "低风险"
      : risk.riskLevel === "medium"
        ? "中风险"
        : "高风险",
    ...risk.signals,
    ...risk.warnings,
  ].filter(Boolean);
  return bits.join("；").slice(0, 200);
}
