"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export interface HomePlan {
  slug: string;
  name: string;
  tagline: string | null;
  durationKind: string;
  durationYears: number | null;
  maxDevices: number;
  priceYuan: number;
  discountYuan: number;
  hasDiscount: boolean;
  discountPct: number;
  saveYuan: number;
  perYearYuan: number | null;
  features: string[];
  highlight: string | null;
  sortOrder: number;
  status: string;
}

/** 价格格式化：整数不显示小数，非整数保留 2 位 */
function formatYuan(n: number): string {
  return n % 1 === 0 ? String(n) : n.toFixed(2);
}

interface HomePageProps {
  isLoggedIn: boolean;
  email: string | null;
  role: string | null;
  plans: HomePlan[];
}

export function HomePage({ isLoggedIn, email, role, plans }: HomePageProps) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <SiteHeader isLoggedIn={isLoggedIn} email={email} role={role} />
      <HeroSection />
      <FeaturesSection />
      <PricingSection plans={plans} isLoggedIn={isLoggedIn} />
      <FaqSection />
      <SiteFooter />
    </div>
  );
}

/* --------------------------------- 头部 --------------------------------- */

function SiteHeader({
  isLoggedIn,
  email,
  role,
}: {
  isLoggedIn: boolean;
  email: string | null;
  role: string | null;
}) {
  return (
    <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
        <div className="flex items-center gap-8">
          <Link href="/" className="flex items-center gap-2">
            <span className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-3.5 w-3.5"
                aria-hidden="true"
              >
                <path d="M12 19l7-7 3 3-7 7-3-3z" />
                <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z" />
                <path d="M2 2l7.586 7.586" />
                <circle cx="11" cy="11" r="2" />
              </svg>
            </span>
            <span className="text-base font-semibold">InkPress</span>
          </Link>
          <nav className="hidden gap-6 text-sm text-muted-foreground md:flex">
            <a href="#features" className="hover:text-foreground">
              功能
            </a>
            <a href="#pricing" className="hover:text-foreground">
              价格
            </a>
            <a href="#faq" className="hover:text-foreground">
              常见问题
            </a>
          </nav>
        </div>
        <div className="flex items-center gap-2">
          {isLoggedIn ? (
            <>
              <span className="hidden text-xs text-muted-foreground sm:inline">
                {email}
              </span>
              <Button asChild size="sm" variant="outline">
                <Link href={role === "ADMIN" ? "/admin" : "/dashboard"}>
                  进入控制台
                </Link>
              </Button>
            </>
          ) : (
            <>
              <Button asChild size="sm" variant="ghost">
                <Link href="/login">登录</Link>
              </Button>
              <Button asChild size="sm">
                <Link href="/register">免费注册</Link>
              </Button>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

/* --------------------------------- Hero --------------------------------- */

function HeroSection() {
  return (
    <section className="relative overflow-hidden border-b">
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.05]"
        style={{
          backgroundImage:
            "radial-gradient(circle at 1px 1px, currentColor 1px, transparent 0)",
          backgroundSize: "32px 32px",
        }}
        aria-hidden="true"
      />
      <div className="mx-auto max-w-6xl px-6 py-20 md:py-28">
        <div className="mx-auto max-w-3xl text-center">
          <Badge variant="secondary" className="mb-5">
            限时折扣 · 全部计划立减
          </Badge>
          <h1 className="text-balance text-4xl font-bold tracking-tight md:text-6xl">
            为创作者打造的
            <span className="text-primary">极简写作</span>工具
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-pretty text-base text-muted-foreground md:text-lg">
            专注内容本身。本地优先、跨设备同步、AI 辅助构思——把繁杂的排版与发布交给 InkPress，
            把时间留给你的文字。
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Button asChild size="lg">
              <Link href="#pricing">查看订阅方案</Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link href="#features">了解功能</Link>
            </Button>
          </div>
          <p className="mt-4 text-xs text-muted-foreground">
            一次买断 · 终身可用 · 所有版本包含持续更新与人工客服
          </p>
        </div>
      </div>
    </section>
  );
}

/* -------------------------------- 功能区 -------------------------------- */

const FEATURES = [
  {
    title: "本地优先",
    desc: "数据存在本地，离线也能完整使用；联网自动同步到所有授权设备。",
    icon: (
      <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
    ),
  },
  {
    title: "AI 写作助手",
    desc: "续写、润色、总结、起标题——边写边构思，无需切换工具。",
    icon: (
      <>
        <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
      </>
    ),
  },
  {
    title: "一键多平台发布",
    desc: "写一次，发布到微信公众号、知乎、掘金、自有博客，无需复制粘贴。",
    icon: (
      <>
        <path d="M3 12l3-3 3 3 3-3 3 3 3-3 3 3" />
        <path d="M3 18h18M3 6h18" />
      </>
    ),
  },
  {
    title: "Markdown 与所见即所得",
    desc: "两种编辑模式无缝切换，写代码块、做表格、贴公式都顺手。",
    icon: (
      <>
        <path d="M3 3h18v18H3zM3 9h18M9 21V9" />
      </>
    ),
  },
  {
    title: "技能模板",
    desc: "预置常用写作框架：周报、技术方案、读书笔记……一键套用不卡壳。",
    icon: (
      <>
        <path d="M4 4h16v16H4zM4 4l4 4M14 14l6 6" />
      </>
    ),
  },
  {
    title: "隐私与版权",
    desc: "你的内容始终归你所有；端到端加密同步，服务器看不到明文。",
    icon: (
      <>
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      </>
    ),
  },
];

function FeaturesSection() {
  return (
    <section id="features" className="border-b">
      <div className="mx-auto max-w-6xl px-6 py-20">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold md:text-4xl">为什么选择 InkPress</h2>
          <p className="mt-3 text-muted-foreground">
            从构思到发布，整套创作者工作流，只装一个 App。
          </p>
        </div>
        <div className="mt-12 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <div
              key={f.title}
              className="rounded-xl border bg-card p-6 text-card-foreground transition-shadow hover:shadow-md"
            >
              <div className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-5 w-5"
                  aria-hidden="true"
                >
                  {f.icon}
                </svg>
              </div>
              <h3 className="text-base font-semibold">{f.title}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{f.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* -------------------------------- 价格区 -------------------------------- */

function PricingSection({
  plans,
  isLoggedIn,
}: {
  plans: HomePlan[];
  isLoggedIn: boolean;
}) {
  return (
    <section id="pricing" className="border-b bg-muted/30">
      <div className="mx-auto max-w-6xl px-6 py-20">
        <div className="mx-auto max-w-2xl text-center">
          <Badge variant="warning" className="mb-4">
            限时折扣
          </Badge>
          <h2 className="text-3xl font-bold md:text-4xl">选择适合你的方案</h2>
          <p className="mt-3 text-muted-foreground">
            一次买断，永久使用；所有版本均含持续更新与人工客服支持。
          </p>
        </div>

        {plans.length === 0 ? (
          <div className="mt-10 rounded-lg border bg-card p-8 text-center text-sm text-muted-foreground">
            暂无可订阅方案，请联系管理员。
          </div>
        ) : (
          <div className="mt-12 grid gap-5 md:grid-cols-2 lg:grid-cols-4">
            {plans.map((p) => (
              <PlanCard key={p.slug} plan={p} isLoggedIn={isLoggedIn} />
            ))}
          </div>
        )}

        <p className="mt-8 text-center text-xs text-muted-foreground">
          所有价格均为人民币，一次性付款；如需企业版 / 团队授权，请{" "}
          <a href="mailto:support@inkpress.app" className="text-primary hover:underline">
            联系我们
          </a>
          。
        </p>
      </div>
    </section>
  );
}

function PlanCard({
  plan,
  isLoggedIn,
}: {
  plan: HomePlan;
  isLoggedIn: boolean;
}) {
  const isInactive = plan.status !== "ACTIVE";
  const isHighlighted = plan.highlight !== null && !isInactive;
  const checkoutHref = `/checkout?plan=${encodeURIComponent(plan.slug)}`;
  const ctaHref = isLoggedIn
    ? checkoutHref
    : `/login?callbackUrl=${encodeURIComponent(checkoutHref)}`;
  const ringClass = isInactive
    ? "border-border opacity-60"
    : plan.highlight === "popular"
      ? "border-primary ring-2 ring-primary/30"
      : plan.highlight === "best_value"
        ? "border-emerald-500 ring-2 ring-emerald-500/30"
        : "border-border";

  const badgeLabel = isInactive
    ? "已下架"
    : plan.highlight === "popular"
      ? "最受欢迎"
      : plan.highlight === "best_value"
        ? "最佳价值"
        : null;

  const durationLabel =
    plan.durationKind === "PERMANENT"
      ? "终身权益"
      : plan.durationYears
        ? `${plan.durationYears} 年权益`
        : plan.durationKind;

  return (
    <div
      className={`relative flex flex-col rounded-xl bg-card p-6 text-card-foreground shadow-sm transition-shadow ${isInactive ? "" : "hover:shadow-md"} ${ringClass}`}
    >
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-lg font-semibold">{plan.name}</h3>
        {badgeLabel && (
          <Badge
            variant={
              isInactive
                ? "secondary"
                : plan.highlight === "popular"
                  ? "default"
                  : "success"
            }
          >
            {badgeLabel}
          </Badge>
        )}
      </div>
      {plan.tagline && (
        <p className="mb-4 min-h-[2.5rem] text-xs text-muted-foreground">
          {plan.tagline}
        </p>
      )}

      <div className="mb-1 flex items-end gap-2">
        <span className="text-3xl font-bold tracking-tight">
          ¥{formatYuan(plan.discountYuan)}
        </span>
        {plan.hasDiscount && (
          <span className="pb-1 text-sm text-muted-foreground line-through">
            ¥{formatYuan(plan.priceYuan)}
          </span>
        )}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
        {plan.hasDiscount && (
          <Badge variant="warning">
            省 ¥{formatYuan(plan.saveYuan)}（{plan.discountPct}% off）
          </Badge>
        )}
        <span className="text-muted-foreground">{durationLabel}</span>
        {plan.perYearYuan !== null && (
          <span className="text-muted-foreground">
            · 折合 ¥{formatYuan(plan.perYearYuan)}/年
          </span>
        )}
      </div>

      <ul className="mb-6 mt-2 space-y-2 text-sm">
        <li className="flex items-center gap-2">
          <CheckIcon /> {plan.maxDevices} 台设备授权
        </li>
        {plan.features.map((f, idx) => (
          <li key={idx} className="flex items-start gap-2">
            <span className="mt-0.5 shrink-0 text-primary">
              <CheckIcon />
            </span>
            <span className="text-muted-foreground">{f}</span>
          </li>
        ))}
      </ul>

      {isInactive ? (
        <Button
          disabled
          className="mt-auto"
          variant="outline"
        >
          已下架 · 暂停售卖
        </Button>
      ) : (
        <Button
          asChild
          className="mt-auto"
          variant={isHighlighted ? "default" : "outline"}
        >
          <Link href={ctaHref}>选择{plan.name}</Link>
        </Button>
      )}
    </div>
  );
}

function CheckIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-3.5 w-3.5"
      aria-hidden="true"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

/* --------------------------------- FAQ --------------------------------- */

const FAQS = [
  {
    q: "「一次买断」是什么意思？",
    a: "你支付一次费用后，对应年限内的所有版本更新与客服支持都包含在内，无任何订阅续费。终身版则永久可用且永久免费更新。",
  },
  {
    q: "授权设备数怎么计算？",
    a: "每台登录并激活的设备占用一个名额；同一台设备重新安装系统不重复计数。可以随时在「我的 License」中查看与解绑。",
  },
  {
    q: "可以换设备吗？",
    a: "可以。解绑旧设备后会立即释放名额，新设备激活即可继续使用，无需联系客服。",
  },
  {
    q: "支持哪些平台？",
    a: "macOS、Windows、Linux 全平台原生应用；同一 License 可跨平台使用，仅受设备数上限约束。",
  },
  {
    q: "折扣会持续多久？",
    a: "限时折扣价由运营策略决定，可能随时调整；下单时锁定的 License 权益不受后续调价影响。",
  },
];

function FaqSection() {
  return (
    <section id="faq" className="border-b">
      <div className="mx-auto max-w-3xl px-6 py-20">
        <h2 className="text-center text-3xl font-bold md:text-4xl">常见问题</h2>
        <div className="mt-10 space-y-6">
          {FAQS.map((f, idx) => (
            <div key={idx} className="rounded-lg border bg-card p-5">
              <h3 className="text-sm font-semibold">{f.q}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{f.a}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* --------------------------------- 页脚 --------------------------------- */

function SiteFooter() {
  return (
    <footer className="bg-muted/30">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-6 py-8 text-sm text-muted-foreground md:flex-row">
        <div className="flex items-center gap-2">
          <span className="inline-flex h-5 w-5 items-center justify-center rounded bg-primary text-primary-foreground text-[10px]">
            IP
          </span>
          <span>© {new Date().getFullYear()} InkPress. All rights reserved.</span>
        </div>
        <nav className="flex flex-wrap items-center justify-center gap-4">
          <a href="#" className="hover:text-foreground">
            关于
          </a>
          <a href="#" className="hover:text-foreground">
            服务条款
          </a>
          <a href="#" className="hover:text-foreground">
            隐私政策
          </a>
          <a href="mailto:support@inkpress.app" className="hover:text-foreground">
            联系我们
          </a>
        </nav>
      </div>
    </footer>
  );
}
