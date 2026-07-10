"use client";

import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  ArrowUpRight,
  Brain,
  Check,
  ChevronRight,
  Download,
  FileText,
  Layers3,
  PenLine,
  Search,
  Send,
  Sparkles,
  Workflow,
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
  dailyStockLimit: number | null;
  dailyRemaining: number | null;
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
    <div className="landing-page min-h-screen overflow-x-clip bg-[#f8fafc] text-foreground">
      <ServiceHeader isLoggedIn={isLoggedIn} email={email} role={role} />
      <main>
        <HeroSection isLoggedIn={isLoggedIn} role={role} />
        <FeaturesSection />
        <CreationFlowSection />
        <CaseDemoSection />
        <PricingSection plans={plans} isLoggedIn={isLoggedIn} />
        <FinalCta isLoggedIn={isLoggedIn} role={role} />
      </main>
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
  const primaryText = isLoggedIn ? "进入工作区" : "开始创作";

  return (
    <section id="home" className="relative isolate scroll-mt-20 overflow-hidden bg-[linear-gradient(145deg,#111b33_0%,#152440_54%,#1b2d4b_100%)] text-white">
      <div className="landing-orb landing-orb--one" />
      <div className="landing-orb landing-orb--two" />
      <div className="landing-grid absolute inset-0 opacity-[0.16]" />

      <div className="relative mx-auto grid min-h-[clamp(680px,calc(100svh-65px),800px)] max-w-[1440px] items-center gap-10 px-5 py-12 sm:px-8 sm:py-14 lg:grid-cols-[0.9fr_1.1fr] lg:gap-12 lg:px-10 xl:px-16">
        <div className="relative z-10 max-w-2xl">
          <div className="landing-reveal inline-flex items-center gap-2 rounded-full bg-white/[0.09] px-3.5 py-2 text-xs font-medium text-blue-50 shadow-[inset_0_1px_rgba(255,255,255,0.12)] backdrop-blur-xl">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue-300 opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-blue-300" />
            </span>
            面向数字媒体创作者的 AI 内容系统
          </div>

          <h1 className="landing-reveal landing-reveal--delay-1 mt-6 text-balance text-[clamp(3.15rem,5.8vw,5.7rem)] font-semibold leading-[0.96] tracking-[-0.05em]">
            让灵感，
            <span className="landing-gradient-text block pb-2">成为作品。</span>
          </h1>
          <p className="landing-reveal landing-reveal--delay-2 mt-5 max-w-xl text-pretty text-base leading-8 text-blue-50/75 sm:text-lg">
            InkPress 把检索、工具调用、写作、素材编排与多渠道交付收束进一个创作工作区，让你把注意力留给判断、观点与表达。
          </p>

          <div className="landing-reveal landing-reveal--delay-3 mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
            <Button asChild size="lg" className="group h-12 rounded-full bg-white px-6 text-slate-950 shadow-[0_12px_35px_rgba(255,255,255,0.12)] hover:bg-blue-50">
              <Link href={primaryHref}>
                {primaryText}
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
              </Link>
            </Button>
            <Button asChild size="lg" variant="ghost" className="h-12 rounded-full bg-white/[0.08] px-6 text-white backdrop-blur hover:bg-white/[0.14] hover:text-white">
              <Link href="/downloads">
                <Download className="h-4 w-4" />
                下载客户端
              </Link>
            </Button>
          </div>

          <div className="landing-reveal landing-reveal--delay-3 mt-8 grid max-w-xl grid-cols-3 gap-2">
            {[
              ["6+", "创作能力"],
              ["3", "真实案例"],
              ["1", "统一工作区"],
            ].map(([value, label], index) => (
              <div key={label} className="rounded-2xl bg-white/[0.055] px-3 py-3.5 backdrop-blur-sm sm:px-4">
                <div className="text-xl font-semibold tracking-tight text-white sm:text-2xl">{value}</div>
                <div className="mt-1 text-[11px] text-blue-100/60 sm:text-xs">{label}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="landing-reveal landing-reveal--delay-2 relative mx-auto w-full max-w-[740px] lg:mx-0">
          <div className="absolute -inset-10 bg-[radial-gradient(circle,rgba(96,165,250,0.23),transparent_62%)] blur-2xl" />
          <div className="landing-hero-frame relative overflow-hidden rounded-[24px] bg-white/[0.12] p-1.5 shadow-[0_28px_75px_rgba(3,8,24,0.36)] backdrop-blur">
            <div className="flex h-8 items-center gap-1.5 rounded-t-[18px] bg-[#172138]/90 px-4">
              <span className="h-2 w-2 rounded-full bg-rose-400/80" />
              <span className="h-2 w-2 rounded-full bg-amber-300/80" />
              <span className="h-2 w-2 rounded-full bg-emerald-400/80" />
              <span className="ml-3 text-[10px] tracking-[0.16em] text-slate-500">INKPRESS WORKSPACE</span>
            </div>
            <div className="relative aspect-[16/10] overflow-hidden rounded-b-[18px]">
              <Image
                src="/assets/inkpress-hero-workflow.png"
                alt="InkPress AI 内容创作工作区"
                fill
                className="object-cover object-center brightness-[1.08] saturate-[0.88] transition duration-700 hover:scale-[1.012]"
                priority
                sizes="(max-width: 1024px) 92vw, 56vw"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-slate-950/35 via-transparent to-transparent" />
            </div>
          </div>

          <div className="landing-float absolute -bottom-4 left-4 hidden items-center gap-3 rounded-2xl bg-[#17233d]/90 px-4 py-3 shadow-xl backdrop-blur-xl sm:flex">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-500/20 text-blue-300">
              <Workflow className="h-4 w-4" />
            </span>
            <span>
              <span className="block text-xs font-medium text-white">创作链路已就绪</span>
              <span className="mt-0.5 block text-[10px] text-slate-400">研究 · 编排 · 发布</span>
            </span>
          </div>
          <div className="landing-float landing-float--late absolute -right-3 top-[16%] hidden rounded-2xl bg-white/[0.14] px-4 py-3 shadow-xl backdrop-blur-xl xl:block">
            <div className="flex items-center gap-2 text-xs text-white">
              <Sparkles className="h-3.5 w-3.5 text-violet-300" />
              AI 协作进行中
            </div>
          </div>
        </div>
      </div>

    </section>
  );
}

const FEATURES = [
  {
    title: "创作意图中枢",
    desc: "从选题、人物、商品或一句想法出发，提炼受众、角度、情绪与作品骨架，让内容先拥有方向感。",
    icon: Brain,
    accent: "violet",
    index: "01",
  },
  {
    title: "联网研究与证据感",
    desc: "在需要外部信息时接入搜索和网页内容，让资料、观点与来源回到同一条创作上下文。",
    icon: Search,
    accent: "blue",
    index: "02",
  },
  {
    title: "工具调用与任务执行",
    desc: "让 Agent 按目标完成检索、整理、分析、改写与校对。过程可见，结果随时可以回看。",
    icon: Wrench,
    accent: "cyan",
    index: "03",
  },
  {
    title: "结构化写作生成",
    desc: "把大纲、段落、标题、脚本、分镜与表达节奏组织成可以继续打磨的作品底稿。",
    icon: Sparkles,
    accent: "amber",
    index: "04",
  },
  {
    title: "素材编排与预览",
    desc: "让图片、封面、附件、参考资料与视觉样式进入作品上下文，持续校准最终呈现。",
    icon: Layers3,
    accent: "rose",
    index: "05",
  },
  {
    title: "多渠道作品发布",
    desc: "面向图文、种草、长文、小说、短剧脚本与 AI 视频整理交付素材，让作品进入真实发布链路。",
    icon: Send,
    accent: "emerald",
    index: "06",
  },
];

function SectionHeading({
  eyebrow,
  title,
  description,
  inverse = false,
}: {
  eyebrow: string;
  title: React.ReactNode;
  description: string;
  inverse?: boolean;
}) {
  return (
    <div className="mx-auto max-w-3xl text-center">
      <div>
        <div className={`mb-4 flex items-center justify-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] ${inverse ? "text-blue-200" : "text-blue-600"}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${inverse ? "bg-blue-200" : "bg-blue-500"}`} />
          {eyebrow}
        </div>
        <h2 className={`text-balance text-3xl font-semibold leading-[1.1] tracking-[-0.035em] sm:text-4xl lg:text-[2.75rem] ${inverse ? "text-white" : "text-slate-950"}`}>
          {title}
        </h2>
      </div>
      <p className={`mx-auto mt-5 max-w-2xl text-pretty text-sm leading-7 sm:text-base ${inverse ? "text-blue-50/70" : "text-slate-600"}`}>
        {description}
      </p>
    </div>
  );
}

function FeaturesSection() {
  return (
    <section id="features" className="relative scroll-mt-16 overflow-hidden bg-[#f8fafc]">
      <div className="absolute -right-44 top-24 h-[420px] w-[420px] rounded-full bg-blue-100/70 blur-3xl" />
      <div className="relative mx-auto max-w-7xl px-5 py-16 sm:px-8 sm:py-20 lg:px-10 lg:py-24">
        <SectionHeading
          eyebrow="Core capabilities"
          title={<>不是一次生成，<br className="hidden sm:block" />而是一条创作链路。</>}
          description="InkPress 围绕数字作品从想法到发布的真实过程，把意图、资料、工具、正文、脚本、素材、预览与交付统一到一个可持续工作的系统里。"
        />

        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:mt-12 lg:grid-cols-3">
          {FEATURES.map((feature) => {
            const Icon = feature.icon;
            return (
              <article key={feature.title} className="landing-feature-card group relative flex min-h-[240px] flex-col overflow-hidden rounded-[22px] bg-white/90 p-6 shadow-[0_14px_44px_rgba(30,64,175,0.055)] ring-1 ring-slate-900/[0.035] sm:p-7">
                <div className={`landing-feature-glow landing-feature-glow--${feature.accent}`} />
                <div className="relative flex items-start justify-between">
                  <span className={`landing-feature-icon landing-feature-icon--${feature.accent}`}>
                    <Icon className="h-5 w-5" />
                  </span>
                  <span className="font-mono text-xs text-slate-300 transition-colors group-hover:text-slate-500">{feature.index}</span>
                </div>
                <div className="relative mt-auto pt-12">
                  <h3 className="text-xl font-semibold tracking-[-0.02em] text-slate-950">{feature.title}</h3>
                  <p className="mt-3 text-sm leading-7 text-slate-600">{feature.desc}</p>
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function CreationFlowSection() {
  return (
    <section id="workflow" className="relative scroll-mt-16 overflow-hidden bg-[linear-gradient(180deg,#f8fafc_0%,#eef4ff_52%,#f8fafc_100%)]">
      <div className="absolute left-1/2 top-1/3 h-[420px] w-[70%] -translate-x-1/2 rounded-full bg-blue-200/35 blur-3xl" />
      <div className="relative mx-auto max-w-7xl px-5 py-16 sm:px-8 sm:py-20 lg:px-10 lg:py-24">
        <SectionHeading
          eyebrow="From idea to impact"
          title={<>从零散素材，<br className="hidden sm:block" />到可以发布的作品。</>}
          description="每一步都延续同一份上下文：研究结果不会散落，素材不会脱离正文，创作意图也不会在多次生成里逐渐丢失。"
        />

        <div className="mt-10 overflow-hidden rounded-[28px] bg-white p-2 shadow-[0_24px_75px_rgba(30,64,175,0.11)] sm:mt-12">
          <div className="relative aspect-[16/9] min-h-[300px] sm:aspect-[2/1]">
            <Image
              src="/assets/inkpress-creation-flow.png"
              alt="从研究素材到多形态数字作品的 AI 创作流程"
              fill
              className="object-cover object-center"
              sizes="(max-width: 1280px) 92vw, 1200px"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-[#111b33]/25 via-transparent to-transparent" />
          </div>
          <div className="grid gap-2 bg-white p-2 sm:grid-cols-3">
            {[
              ["01", "理解与研究", "识别目标，收集资料与证据"],
              ["02", "协作与编排", "调用工具，组织内容与素材"],
              ["03", "预览与交付", "校准呈现，适配真实渠道"],
            ].map(([num, title, desc]) => (
              <div key={num} className="rounded-2xl bg-[#f4f7fd] p-5 sm:p-6">
                <span className="font-mono text-[10px] text-blue-500">{num}</span>
                <h3 className="mt-2 text-base font-medium text-slate-900">{title}</h3>
                <p className="mt-1 text-xs leading-6 text-slate-500">{desc}</p>
              </div>
            ))}
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
  embedUrl: string;
  tone: string;
};

const DEMO_CASES: DemoCase[] = [
  {
    eyebrow: "研究型创作",
    title: "网络调研，编写推广文章",
    desc: "基于 InkPress AI 进行网络调研，整理话题资料与表达角度，并产出可继续打磨的推广文案。",
    icon: PenLine,
    tone: "from-blue-500/20 to-violet-500/10",
    embedUrl: "https://player.bilibili.com/player.html?bvid=BV1cUT16XEdj&page=1&autoplay=0&high_quality=1&danmaku=0&t=66.1",
  },
  {
    eyebrow: "素材型创作",
    title: "加载素材，穿插媒体资料",
    desc: "把图片、参考资料与外部链接作为素材载入会话，让 AI 在写作中按需穿插图片、引用与媒体片段。",
    icon: Layers3,
    tone: "from-cyan-500/20 to-blue-500/10",
    embedUrl: "https://player.bilibili.com/player.html?bvid=BV1J9T16JEHd&page=1&autoplay=0&high_quality=1&danmaku=0&t=48.1",
  },
  {
    eyebrow: "技术型创作",
    title: "探索项目，编写技术文章",
    desc: "让 AI 读取本地或 GitHub 代码项目，基于真实代码结构写出有出处、可校验的技术文章。",
    icon: FileText,
    tone: "from-amber-500/20 to-orange-500/10",
    embedUrl: "https://player.bilibili.com/player.html?bvid=BV1z9T16EE1e&page=1&autoplay=0&high_quality=1&danmaku=0&t=30.2",
  },
];

function CaseDemoSection() {
  return (
    <section id="cases" className="relative scroll-mt-16 overflow-hidden bg-[#f8fafc]">
      <div className="relative mx-auto max-w-7xl px-5 py-16 sm:px-8 sm:py-20 lg:px-10 lg:py-24">
        <SectionHeading
          eyebrow="Real workflows"
          title={<>三个真实场景，<br className="hidden sm:block" />看见工作方式。</>}
          description="不展示脱离上下文的漂亮结果，而是把调研、素材组织与项目探索中的完整 AI 写作过程放到你面前。"
        />

        <div className="mt-10 grid gap-5 lg:mt-12 lg:grid-cols-2">
          {DEMO_CASES.map((item, index) => {
            const Icon = item.icon;
            const isFeature = index === 0;
            return (
              <article key={item.title} className={`group overflow-hidden rounded-[24px] bg-white shadow-[0_16px_50px_rgba(30,64,175,0.065)] ring-1 ring-slate-900/[0.035] ${isFeature ? "lg:row-span-2" : "lg:grid lg:grid-cols-[1.06fr_0.94fr]"}`}>
                <div className={`relative overflow-hidden bg-gradient-to-br ${item.tone} ${isFeature ? "aspect-video" : "aspect-video lg:aspect-auto lg:min-h-[260px]"}`}>
                  <iframe
                    className="absolute inset-0 h-full w-full"
                    src={item.embedUrl}
                    title={`${item.title} - B 站演示视频`}
                    loading="lazy"
                    scrolling="no"
                    frameBorder={0}
                    allowFullScreen
                    referrerPolicy="strict-origin-when-cross-origin"
                  />
                  <div className="pointer-events-none absolute left-4 top-4 rounded-full bg-slate-900/65 px-3 py-1.5 text-[10px] font-medium tracking-wide text-white shadow-lg backdrop-blur-xl">
                    CASE 0{index + 1}
                  </div>
                </div>
                <div className={`flex flex-col p-6 ${isFeature ? "sm:p-8" : "lg:justify-center"}`}>
                  <div className="flex items-center gap-2 text-xs font-semibold text-blue-600">
                    <Icon className="h-4 w-4" />
                    {item.eyebrow}
                  </div>
                  <h3 className={`mt-4 font-semibold tracking-[-0.025em] text-slate-950 ${isFeature ? "text-2xl sm:text-3xl" : "text-xl"}`}>
                    {item.title}
                  </h3>
                  <p className="mt-3 text-sm leading-7 text-slate-600">{item.desc}</p>
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function PricingSection({ plans, isLoggedIn }: { plans: HomePlan[]; isLoggedIn: boolean }) {
  return (
    <section id="pricing" className="relative scroll-mt-16 overflow-hidden bg-[linear-gradient(180deg,#f8fafc_0%,#f1f5fb_100%)]">
      <div className="absolute left-1/2 top-0 h-64 w-[70%] -translate-x-1/2 rounded-full bg-blue-100/55 blur-3xl" />
      <div className="relative mx-auto max-w-7xl px-5 py-16 sm:px-8 sm:py-20 lg:px-10 lg:py-24">
        <SectionHeading
          eyebrow="Simple pricing"
          title={<>为持续创作，<br className="hidden sm:block" />选择合适的节奏。</>}
          description="方案按创作频率、设备数量与更新周期划分。没有隐藏的复杂层级，已购买权益可在用户中心随时查看。"
        />

        <div className="mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs text-slate-500">
          {["一次购买，按方案周期使用", "支持多台常用设备", "持续获得版本更新"].map((item) => (
            <span key={item} className="flex items-center gap-2">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-100 text-emerald-700"><Check className="h-3 w-3" /></span>
              {item}
            </span>
          ))}
        </div>

        {plans.length === 0 ? (
          <div className="mt-10 rounded-[22px] bg-white p-10 text-center text-sm text-slate-500 shadow-sm">
            暂无可选方案，请稍后再来查看。
          </div>
        ) : (
          <div className="mt-10 grid items-stretch gap-5 md:grid-cols-2 xl:grid-cols-4">
            {plans.map((plan) => <PlanCard key={plan.slug} plan={plan} isLoggedIn={isLoggedIn} />)}
          </div>
        )}
        <p className="mt-8 text-center text-xs leading-6 text-slate-500">
          价格与库存以结算页为准。购买前有疑问？<a href="mailto:support@inkpress.app" className="font-medium text-blue-600 hover:underline">联系支持</a>
        </p>
      </div>
    </section>
  );
}

function PlanCard({ plan, isLoggedIn }: { plan: HomePlan; isLoggedIn: boolean }) {
  const isInactive = plan.status !== "ACTIVE";
  const isSoldOut = !isInactive && plan.soldOut;
  const isHighlighted = plan.highlight !== null && !isInactive;
  const checkoutHref = `/checkout?plan=${encodeURIComponent(plan.slug)}`;
  const ctaHref = isLoggedIn ? checkoutHref : `/login?callbackUrl=${encodeURIComponent(checkoutHref)}`;
  const badgeLabel = isInactive ? "已下架" : isSoldOut ? "今日售罄" : plan.highlight === "popular" ? "最受欢迎" : plan.highlight === "best_value" ? "最佳价值" : null;
  const ctaDisabled = isInactive || isSoldOut;
  const stockHint = !isInactive && !isSoldOut && plan.dailyStockLimit !== null && plan.dailyRemaining !== null && plan.dailyRemaining <= 1 ? `仅剩 ${plan.dailyRemaining} 件` : null;
  const durationLabel = plan.durationKind === "PERMANENT" ? "终身权益" : plan.durationYears ? `${plan.durationYears} 年权益` : plan.durationKind;

  return (
    <article className={`group relative flex min-h-[465px] flex-col overflow-hidden rounded-[22px] bg-white p-6 ring-1 transition duration-300 ${isInactive || isSoldOut ? "opacity-60 ring-slate-900/[0.04]" : isHighlighted ? "bg-[linear-gradient(180deg,#ffffff_0%,#f7faff_100%)] shadow-[0_22px_60px_rgba(37,99,235,0.12)] ring-blue-300/50 xl:-translate-y-1" : "shadow-[0_14px_44px_rgba(15,23,42,0.05)] ring-slate-900/[0.04] hover:-translate-y-1 hover:shadow-[0_20px_55px_rgba(15,23,42,0.075)]"}`}>
      {isHighlighted && <div className={`absolute inset-x-0 top-0 h-1 ${plan.highlight === "best_value" ? "bg-gradient-to-r from-emerald-400 to-cyan-400" : "bg-gradient-to-r from-blue-500 to-violet-500"}`} />}
      <div className="flex min-h-7 items-start justify-between gap-3">
        <h3 className="text-lg font-semibold tracking-tight text-slate-950">{plan.name}</h3>
        {badgeLabel && <Badge variant={isInactive ? "secondary" : plan.highlight === "popular" ? "default" : "success"} className="rounded-full px-2.5">{badgeLabel}</Badge>}
      </div>
      <p className="mt-2 min-h-[2.5rem] text-xs leading-5 text-slate-500">{plan.tagline ?? "适合稳定、持续的内容创作"}</p>

      <div className="mt-6 flex items-end gap-2">
        <span className="pb-1 text-base font-medium text-slate-500">¥</span>
        <span className="text-4xl font-semibold tracking-[-0.045em] text-slate-950">{formatYuan(plan.discountYuan)}</span>
        {plan.hasDiscount && <span className="pb-1 text-xs text-slate-400 line-through">¥{formatYuan(plan.priceYuan)}</span>}
      </div>
      <div className="mt-2 flex min-h-10 flex-wrap items-start gap-1.5 text-xs">
        {plan.hasDiscount && <Badge variant="warning" className="rounded-full">省 ¥{formatYuan(plan.saveYuan)}</Badge>}
        {stockHint && <Badge variant="warning" className="rounded-full">{stockHint}</Badge>}
        <span className="pt-1 text-slate-500">{durationLabel}</span>
        {plan.perYearYuan !== null && <span className="pt-1 text-slate-400">· ¥{formatYuan(plan.perYearYuan)}/年</span>}
      </div>

      <ul className="mb-6 mt-6 space-y-3 text-sm">
        <li className="flex items-start gap-2.5 text-slate-700"><Check className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" />支持 {plan.maxDevices} 台常用设备</li>
        {plan.features.filter(isPublicPlanFeature).map((feature, index) => (
          <li key={index} className="flex items-start gap-2.5 text-slate-600"><Check className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" /><span>{feature}</span></li>
        ))}
      </ul>
      <Button asChild={!ctaDisabled} disabled={ctaDisabled} className={`mt-auto h-11 rounded-full ${isHighlighted ? "shadow-[0_10px_25px_rgba(37,99,235,0.22)]" : ""}`} variant={isHighlighted ? "default" : "outline"}>
        {isInactive ? <span>已下架 · 暂停售卖</span> : isSoldOut ? <span>今日已售罄</span> : <Link href={ctaHref} className="group/cta">选择{plan.name}<ChevronRight className="h-4 w-4 transition-transform group-hover/cta:translate-x-0.5" /></Link>}
      </Button>
    </article>
  );
}

function FinalCta({ isLoggedIn, role }: { isLoggedIn: boolean; role: string | null }) {
  const href = isLoggedIn ? (role === "ADMIN" ? "/admin" : "/dashboard") : "/register";
  return (
    <section className="relative overflow-hidden bg-[#f1f5fb] px-5 py-12 sm:px-8 sm:py-16">
      <div className="relative mx-auto max-w-7xl overflow-hidden rounded-[28px] bg-[linear-gradient(135deg,#e7efff_0%,#f4f7ff_52%,#e9f4ff_100%)] px-6 py-14 text-center text-slate-950 shadow-[0_20px_65px_rgba(30,64,175,0.09)] sm:px-12 sm:py-18">
        <div className="absolute left-1/2 top-0 h-64 w-2/3 -translate-x-1/2 rounded-full bg-white/70 blur-3xl" />
        <div className="relative mx-auto max-w-3xl">
          <span className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-600">Ready when you are</span>
          <h2 className="mt-5 text-balance text-3xl font-semibold tracking-[-0.04em] sm:text-5xl">下一篇值得被看见的作品，从这里开始。</h2>
          <p className="mx-auto mt-5 max-w-xl text-sm leading-7 text-slate-600 sm:text-base">建立一条稳定、清晰、可以复用的数字内容创作工作流。</p>
          <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
            <Button asChild size="lg" className="h-12 rounded-full px-6 shadow-[0_10px_25px_rgba(37,99,235,0.18)]"><Link href={href}>{isLoggedIn ? "进入工作区" : "免费注册"}<ArrowRight className="h-4 w-4" /></Link></Button>
            <Button asChild size="lg" variant="ghost" className="h-12 rounded-full bg-white/65 px-6 text-slate-700 hover:bg-white hover:text-slate-950"><Link href="/guide">查看使用指引<ArrowUpRight className="h-4 w-4" /></Link></Button>
          </div>
        </div>
      </div>
    </section>
  );
}

function SiteFooter() {
  const year = new Date().getFullYear();
  return (
    <footer className="bg-[#15223a] text-slate-300">
      <div className="mx-auto max-w-7xl px-5 py-14 sm:px-8 lg:px-10">
        <div className="grid gap-10 md:grid-cols-[1.35fr_0.65fr_0.65fr_0.85fr]">
          <div className="max-w-sm">
            <Link href="/" className="inline-flex items-center gap-2.5 text-white" aria-label="InkPress 首页">
              <Image src="/inkpress-logo.png" alt="" width={30} height={30} className="h-8 w-8 rounded-lg" />
              <span className="text-lg font-semibold tracking-tight">InkPress</span>
            </Link>
            <p className="mt-5 text-sm leading-7">面向数字媒体创作者的 AI 内容系统。让研究、写作、素材编排与发布交付始终处在同一条创作链路。</p>
          </div>
          <FooterGroup title="产品" links={[["功能", "/#features"], ["案例", "/#cases"], ["价格", "/#pricing"], ["下载", "/downloads"]]} />
          <FooterGroup title="资源" links={[["使用指引", "/guide"], ["用户中心", "/dashboard"], ["问题工单", "/dashboard/tickets"]]} />
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-200">联系我们</h3>
            <a href="mailto:support@inkpress.app" className="mt-4 inline-flex items-center gap-1.5 text-sm text-slate-400 transition hover:text-white">support@inkpress.app<ArrowUpRight className="h-3.5 w-3.5" /></a>
            <p className="mt-3 text-xs leading-6 text-slate-500">产品使用、购买与技术问题均可通过邮件或用户中心工单联系。</p>
          </div>
        </div>
        <div className="mt-10 flex flex-col gap-3 pt-4 text-xs text-slate-400/70 sm:flex-row sm:items-center sm:justify-between">
          <span>© {year} InkPress · 数字文刊工坊</span>
          <span>为持续创作而设计</span>
        </div>
      </div>
    </footer>
  );
}

function FooterGroup({ title, links }: { title: string; links: [string, string][] }) {
  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-200">{title}</h3>
      <nav className="mt-4 flex flex-col gap-3 text-sm">
        {links.map(([label, href]) => <Link key={href} href={href} className="w-fit transition hover:text-white">{label}</Link>)}
      </nav>
    </div>
  );
}
