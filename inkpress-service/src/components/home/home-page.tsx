"use client";

import Image from "next/image";
import Link from "next/link";
import {
  Brain,
  Check,
  ChevronRight,
  Download,
  Layers3,
  PenLine,
  Search,
  Send,
  Sparkles,
  Wrench,
} from "lucide-react";
import { ServiceHeader } from "@/components/navigation/service-header";
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
  /** 每日库存上限：null = 不限 */
  dailyStockLimit: number | null;
  /** 今日剩余（null = 不限） */
  dailyRemaining: number | null;
  /** 是否售罄（dailyStockLimit 非 null 且 dailyRemaining === 0） */
  soldOut: boolean;
}

function formatYuan(n: number): string {
  return n % 1 === 0 ? String(n) : n.toFixed(2);
}

function isPublicPlanFeature(feature: string): boolean {
  return !/(License|license|授权|后台|管理员|审计|激活)/.test(feature);
}

interface HomePageProps {
  isLoggedIn: boolean;
  email: string | null;
  role: string | null;
  plans: HomePlan[];
}

export function HomePage({ isLoggedIn, email, role, plans }: HomePageProps) {
  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,#ffffff_0%,#f8fafc_52%,#ffffff_100%)] text-foreground">
      <ServiceHeader isLoggedIn={isLoggedIn} email={email} role={role} />
      <HeroSection isLoggedIn={isLoggedIn} role={role} />
      <FeaturesSection />
      <CaseDemoSection />
      <PricingSection plans={plans} isLoggedIn={isLoggedIn} />
      <SiteFooter />
    </div>
  );
}

function HeroSection({
  isLoggedIn,
  role,
}: {
  isLoggedIn: boolean;
  role: string | null;
}) {
  const primaryHref = isLoggedIn ? (role === "ADMIN" ? "/admin" : "/dashboard") : "/register";
  const primaryText = isLoggedIn ? "进入工作区" : "开始使用";

  return (
    <section id="home" className="relative min-h-[100svh] scroll-mt-16 overflow-hidden border-b bg-[#111827] text-white">
      <Image
        src="/assets/inkpress-hero-workflow.png"
        alt="InkPress 数字内容工作台界面"
        fill
        className="object-cover object-center"
        priority
        sizes="100vw"
      />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_58%_34%,rgba(37,99,235,0.22),transparent_34%),linear-gradient(180deg,rgba(2,6,23,0.82)_0%,rgba(2,6,23,0.74)_48%,rgba(2,6,23,0.9)_100%)]" />
      <div className="absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-slate-950/70 to-transparent" />
      <div className="relative mx-auto flex min-h-[100svh] max-w-7xl items-center px-4 py-14 sm:px-6 md:py-16">
        <div className="mx-auto w-full max-w-5xl text-center">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full bg-white/10 px-4 py-2 text-xs font-medium text-slate-100 shadow-sm backdrop-blur-md">
            <Sparkles className="h-3.5 w-3.5 text-blue-300" />
            面向数字媒体创作者的 AI 内容系统
          </div>
          <h1 className="text-balance text-5xl font-bold leading-[1.02] tracking-normal md:text-7xl">
            InkPress
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-pretty text-lg leading-8 text-slate-200 md:text-xl">
            让创作者把注意力留给判断、观点与表达，把检索、工具调用、写作、排版和交付收束进同一个创作系统。
          </p>
          <div className="mx-auto mt-6 flex max-w-3xl flex-wrap items-center justify-center gap-x-4 gap-y-2 text-sm text-slate-300">
            <span>创作意图驱动</span>
            <span className="h-1 w-1 rounded-full bg-blue-300/80" />
            <span>联网研究与工具执行</span>
            <span className="h-1 w-1 rounded-full bg-blue-300/80" />
            <span>多渠道作品发布</span>
          </div>
          <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
            <Button asChild size="lg" className="w-full sm:w-auto">
              <Link href={primaryHref}>
                {primaryText}
                <ChevronRight className="h-4 w-4" />
              </Link>
            </Button>
            <Button asChild size="lg" variant="ghost" className="w-full bg-[rgba(255,255,255,0.08)] text-white hover:bg-[rgba(255,255,255,0.14)] hover:text-white sm:w-auto">
              <Link href="/downloads">
                <Download className="h-4 w-4" />
                下载 InkPress
              </Link>
            </Button>
          </div>
          <div className="mx-auto mt-12 grid max-w-3xl gap-6 text-left sm:grid-cols-3">
            {[
              ["01", "识别创作目标"],
              ["02", "组织资料证据"],
              ["03", "交付发布成稿"],
            ].map(([num, label]) => (
              <div key={num} className="relative pt-4">
                <div className="absolute left-0 top-0 h-px w-full bg-gradient-to-r from-blue-300/70 to-transparent" />
                <div className="font-mono text-xs text-blue-200/90">{num}</div>
                <div className="mt-2 text-sm font-medium text-slate-100">{label}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

const FEATURES = [
  {
    title: "创作意图中枢",
    desc: "从选题、人物、商品或一句想法出发，提炼受众、角度、情绪和作品骨架，让内容先有方向感。",
    icon: Brain,
  },
  {
    title: "联网研究与证据感",
    desc: "在需要外部信息时接入搜索和网页内容，把资料、观点与来源放回同一条创作上下文。",
    icon: Search,
  },
  {
    title: "工具调用与任务执行",
    desc: "让 Agent 按目标调用能力完成检索、整理、分析、改写和校对，过程可见，结果可回看。",
    icon: Wrench,
  },
  {
    title: "结构化写作生成",
    desc: "把大纲、段落、标题、脚本、分镜和表达节奏组织成可继续打磨的作品底稿。",
    icon: Sparkles,
  },
  {
    title: "素材编排与预览",
    desc: "把图片、封面、附件、参考资料和视觉样式纳入同一份作品上下文，持续校准最终呈现。",
    icon: Layers3,
  },
  {
    title: "多渠道作品发布",
    desc: "面向图文、种草、长文、小说、短剧脚本和 AI 视频等形态整理交付素材，让作品更容易进入真实发布链路。",
    icon: Send,
  },
];

function FeaturesSection() {
  return (
    <section id="features" className="relative scroll-mt-0 overflow-hidden border-b bg-white">
      <div className="absolute inset-x-0 top-0 h-40 bg-[linear-gradient(180deg,#f8fafc_0%,rgba(255,255,255,0.92)_58%,rgba(255,255,255,0)_100%)]" />
      <div className="absolute inset-x-0 top-0 h-px bg-slate-200/80" />
      <div className="relative mx-auto max-w-7xl px-4 pb-16 pt-[clamp(5.5rem,10vh,7.5rem)] sm:px-6 md:pb-20">
        <div className="w-full">
          <div className="mx-auto max-w-4xl text-center">
            <Badge variant="secondary" className="mb-3">产品能力</Badge>
            <h2 className="text-3xl font-bold tracking-normal md:text-4xl">
              六个能力定义 AI 驱动的数字媒体创作方式
            </h2>
            <p className="mx-auto mt-3 max-w-3xl text-sm leading-7 text-muted-foreground md:text-base">
              InkPress 不只是写作框，也不是单次生成器。它围绕数字作品从想法到发布的真实链路，把意图、资料、工具、正文、脚本、素材、预览和交付统一到一个可持续工作的系统里。
            </p>
          </div>
          <div className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((feature) => {
              const Icon = feature.icon;
              return (
                <article key={feature.title} className="group flex min-h-[178px] flex-col rounded-lg border border-slate-200/70 bg-white/[0.86] p-6 shadow-[0_18px_60px_rgba(15,23,42,0.055)] backdrop-blur transition duration-200 hover:-translate-y-0.5 hover:shadow-[0_22px_70px_rgba(15,23,42,0.08)]">
                  <div className="mb-5 inline-flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50 text-primary ring-1 ring-blue-100">
                    <Icon className="h-5 w-5" />
                  </div>
                  <h3 className="text-lg font-semibold">{feature.title}</h3>
                  <p className="mt-2 text-sm leading-7 text-muted-foreground">{feature.desc}</p>
                </article>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}

type DemoCase = {
  title: string;
  eyebrow: string;
  desc: string;
  icon: typeof Sparkles;
  videoSrc: string | null;
};

const DEMO_CASES: DemoCase[] = [
  {
    eyebrow: "案例 01",
    title: "从一个选题到可编辑初稿",
    desc: "演示 InkPress 如何围绕主题补充资料、整理角度，并生成可继续打磨的文章结构。",
    icon: PenLine,
    videoSrc: null,
  },
  {
    eyebrow: "案例 02",
    title: "素材、封面与作品预览",
    desc: "演示图片、封面、参考资料和视觉样式如何围绕同一份作品被组织和校准。",
    icon: Layers3,
    videoSrc: null,
  },
  {
    eyebrow: "案例 03",
    title: "从底稿到多渠道发布",
    desc: "演示图文、种草文案、小说片段、短剧脚本或 AI 视频创意如何完成发布前整理。",
    icon: Send,
    videoSrc: null,
  },
];

function CaseDemoSection() {
  return (
    <section id="cases" className="relative scroll-mt-0 overflow-hidden border-b bg-[linear-gradient(180deg,#f8fafc_0%,#ffffff_100%)]">
      <div className="absolute inset-x-0 top-0 h-px bg-slate-200/80" />
      <div className="relative mx-auto max-w-7xl px-4 py-16 sm:px-6 md:py-20">
        <div className="w-full">
          <div className="mx-auto max-w-4xl text-center">
            <Badge variant="secondary" className="mb-3">案例演示</Badge>
            <h2 className="text-3xl font-bold tracking-normal md:text-4xl">
              用三个场景看见 InkPress 的真实工作方式
            </h2>
            <p className="mx-auto mt-3 max-w-3xl text-sm leading-7 text-muted-foreground md:text-base">
              这里会承载三段产品演示视频。当前先保留完整的视频版式和案例文案，后续补充链接后即可直接展示真实内容。
            </p>
          </div>
          <div className="mt-10 grid gap-4 lg:grid-cols-[1.22fr_0.78fr]">
            {DEMO_CASES.map((item, index) => {
              const Icon = item.icon;
              const isFeature = index === 0;
              return (
                <article
                  key={item.title}
                  className={`overflow-hidden rounded-lg border border-slate-200/70 bg-white/[0.9] shadow-[0_18px_60px_rgba(15,23,42,0.055)] backdrop-blur ${
                    isFeature ? "lg:row-span-2" : ""
                  }`}
                >
                  <div className="relative aspect-video overflow-hidden bg-[linear-gradient(135deg,#0f172a_0%,#1f2937_58%,#2563eb_100%)]">
                    {item.videoSrc ? (
                      <video
                        className="h-full w-full object-cover"
                        src={item.videoSrc}
                        controls
                        preload="metadata"
                      />
                    ) : (
                      <div className="flex h-full w-full flex-col items-center justify-center px-6 text-center text-white">
                        <span className="mb-4 inline-flex h-14 w-14 items-center justify-center rounded-full bg-white/12 ring-1 ring-white/20">
                          <Icon className="h-6 w-6" />
                        </span>
                        <span className="text-sm font-medium text-white/92">{item.eyebrow}</span>
                        <span className="mt-2 text-lg font-semibold tracking-normal md:text-xl">
                          视频即将上线
                        </span>
                      </div>
                    )}
                    <div className="absolute left-4 top-4 rounded-full bg-black/36 px-3 py-1 text-xs font-medium text-white backdrop-blur">
                      {item.eyebrow}
                    </div>
                  </div>
                  <div className={`p-5 ${isFeature ? "md:p-7" : ""}`}>
                    <div className="flex items-start gap-3">
                      <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-primary ring-1 ring-blue-100">
                        <Icon className="h-5 w-5" />
                      </span>
                      <div>
                        <h3 className={`${isFeature ? "text-xl md:text-2xl" : "text-lg"} font-semibold tracking-normal`}>
                          {item.title}
                        </h3>
                        <p className="mt-2 text-sm leading-7 text-muted-foreground">{item.desc}</p>
                      </div>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}

function PricingSection({
  plans,
  isLoggedIn,
}: {
  plans: HomePlan[];
  isLoggedIn: boolean;
}) {
  return (
    <section id="pricing" className="relative scroll-mt-0 overflow-hidden border-b bg-white/80">
      <div className="absolute inset-x-0 top-0 h-px bg-slate-200/80" />
      <div className="relative mx-auto max-w-7xl px-4 py-16 sm:px-6 md:py-20">
        <div className="w-full">
          <div className="mx-auto max-w-3xl text-center">
            <Badge variant="warning" className="mb-3">限时折扣</Badge>
            <h2 className="text-3xl font-bold tracking-normal md:text-4xl">
              选择适合你的 InkPress 使用方案
            </h2>
            <p className="mt-3 text-sm text-muted-foreground md:text-base">
              按你的创作频率、设备数量和更新周期选择方案，让写作、脚本、素材管理、作品预览和多渠道发布保持稳定可用。
            </p>
          </div>

          {plans.length === 0 ? (
            <div className="mt-8 rounded-lg border bg-card p-8 text-center text-sm text-muted-foreground">
              暂无可选方案，请稍后再来查看。
            </div>
          ) : (
            <div className="mt-9 grid items-stretch gap-4 md:grid-cols-2 xl:grid-cols-4">
              {plans.map((plan) => (
                <PlanCard key={plan.slug} plan={plan} isLoggedIn={isLoggedIn} />
              ))}
            </div>
          )}
        </div>
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
  const isSoldOut = !isInactive && plan.soldOut;
  const isHighlighted = plan.highlight !== null && !isInactive;
  const checkoutHref = `/checkout?plan=${encodeURIComponent(plan.slug)}`;
  const ctaHref = isLoggedIn
    ? checkoutHref
    : `/login?callbackUrl=${encodeURIComponent(checkoutHref)}`;
  const ringClass = isInactive || isSoldOut
    ? "border-slate-200/70 opacity-60"
    : plan.highlight === "popular"
      ? "border-blue-300/80 shadow-[0_22px_70px_rgba(37,99,235,0.12)]"
      : plan.highlight === "best_value"
        ? "border-emerald-300/80 shadow-[0_22px_70px_rgba(16,185,129,0.12)]"
        : "border-slate-200/70 shadow-[0_18px_60px_rgba(15,23,42,0.055)]";
  const badgeLabel = isInactive
    ? "已下架"
    : isSoldOut
      ? "今日售罄"
      : plan.highlight === "popular"
        ? "最受欢迎"
        : plan.highlight === "best_value"
          ? "最佳价值"
          : null;
  const ctaDisabled = isInactive || isSoldOut;
  const stockHint =
    !isInactive && !isSoldOut && plan.dailyStockLimit !== null && plan.dailyRemaining !== null
      ? plan.dailyRemaining <= 1
        ? `仅剩 ${plan.dailyRemaining} 件`
        : null
      : null;
  const durationLabel =
    plan.durationKind === "PERMANENT"
      ? "终身权益"
      : plan.durationYears
        ? `${plan.durationYears} 年权益`
        : plan.durationKind;

  return (
    <article className={`relative flex flex-col overflow-hidden rounded-lg border bg-white/[0.9] p-5 backdrop-blur transition duration-200 ${isInactive ? "" : "hover:-translate-y-0.5"} ${ringClass}`}>
      {!isInactive && plan.highlight && (
        <div
          className={`absolute inset-x-0 top-0 h-1 ${
            plan.highlight === "best_value" ? "bg-emerald-400" : "bg-primary"
          }`}
        />
      )}
      <div className="mb-2 flex items-start justify-between gap-3">
        <h3 className="text-lg font-semibold">{plan.name}</h3>
        {badgeLabel && (
          <Badge variant={isInactive ? "secondary" : plan.highlight === "popular" ? "default" : "success"}>
            {badgeLabel}
          </Badge>
        )}
      </div>
      {plan.tagline && (
        <p className="mb-3 min-h-[2.25rem] text-xs leading-5 text-muted-foreground">
          {plan.tagline}
        </p>
      )}
      <div className="mb-1 flex items-end gap-2">
        <span className="text-3xl font-bold tracking-normal md:text-[2rem]">¥{formatYuan(plan.discountYuan)}</span>
        {plan.hasDiscount && (
          <span className="pb-1 text-sm text-muted-foreground line-through">
            ¥{formatYuan(plan.priceYuan)}
          </span>
        )}
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
        {plan.hasDiscount && (
          <Badge variant="warning">
            省 ¥{formatYuan(plan.saveYuan)}（{plan.discountPct}% off）
          </Badge>
        )}
        {stockHint && (
          <Badge variant="warning">{stockHint}</Badge>
        )}
        <span className="text-muted-foreground">{durationLabel}</span>
        {plan.perYearYuan !== null && (
          <span className="text-muted-foreground">· 折合 ¥{formatYuan(plan.perYearYuan)}/年</span>
        )}
      </div>
      <ul className="mb-5 mt-1 space-y-1.5 text-sm">
        <li className="flex items-center gap-2">
          <Check className="h-3.5 w-3.5 text-primary" />
          支持 {plan.maxDevices} 台常用设备
        </li>
        {plan.features.filter(isPublicPlanFeature).map((feature, index) => (
          <li key={index} className="flex items-start gap-2">
            <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
            <span className="text-muted-foreground">{feature}</span>
          </li>
        ))}
      </ul>
      <Button
        asChild={!ctaDisabled}
        disabled={ctaDisabled}
        className="mt-auto"
        variant={isHighlighted ? "default" : "outline"}
      >
        {isInactive ? (
          <span>已下架 · 暂停售卖</span>
        ) : isSoldOut ? (
          <span>今日已售罄 · 明日 0 点重置</span>
        ) : (
          <Link href={ctaHref}>选择{plan.name}</Link>
        )}
      </Button>
    </article>
  );
}

function SiteFooter() {
  return (
    <footer className="bg-muted/30">
      <div className="mx-auto flex max-w-7xl flex-col gap-5 px-4 py-8 text-sm text-muted-foreground sm:px-6 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-2">
          <Image src="/inkpress-logo.png" alt="" width={22} height={22} className="h-5 w-5 rounded" />
          <span>© {new Date().getFullYear()} InkPress. All rights reserved.</span>
        </div>
        <nav className="flex flex-wrap items-center gap-4">
          <Link href="/dashboard" className="hover:text-foreground">控制台</Link>
          <Link href="/downloads" className="hover:text-foreground">下载</Link>
          <a href="mailto:support@inkpress.app" className="hover:text-foreground">联系我们</a>
        </nav>
      </div>
    </footer>
  );
}
