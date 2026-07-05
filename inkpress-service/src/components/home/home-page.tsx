"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  BookOpen,
  Check,
  ChevronRight,
  FileText,
  Layers3,
  LifeBuoy,
  PenLine,
  Plus,
  Send,
  Sparkles,
  Ticket,
  Workflow,
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
      <WorkflowSection />
      <PricingSection plans={plans} isLoggedIn={isLoggedIn} />
      <GuideSection />
      <FaqSection />
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
        alt="InkPress 数字内容工作流界面"
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
            Claude Agent 驱动的内容自动化工作台
          </div>
          <h1 className="text-balance text-5xl font-bold leading-[1.02] tracking-normal md:text-7xl">
            InkPress
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-pretty text-lg leading-8 text-slate-200 md:text-xl">
            把选题、写作、排版、素材与发布交给一条可编排的 Agent 工作流。
          </p>
          <div className="mx-auto mt-6 flex max-w-3xl flex-wrap items-center justify-center gap-x-4 gap-y-2 text-sm text-slate-300">
            <span>Claude Agent Engine</span>
            <span className="h-1 w-1 rounded-full bg-blue-300/80" />
            <span>自动化任务编排</span>
            <span className="h-1 w-1 rounded-full bg-blue-300/80" />
            <span>Markdown 到公众号发布</span>
          </div>
          <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
            <Button asChild size="lg" className="w-full sm:w-auto">
              <Link href={primaryHref}>
                {primaryText}
                <ChevronRight className="h-4 w-4" />
              </Link>
            </Button>
            <Button asChild size="lg" variant="ghost" className="w-full bg-[rgba(255,255,255,0.08)] text-white hover:bg-[rgba(255,255,255,0.14)] hover:text-white sm:w-auto">
              <Link href="/guide">
                <BookOpen className="h-4 w-4" />
                快速开始
              </Link>
            </Button>
          </div>
          <div className="mx-auto mt-12 grid max-w-3xl gap-6 text-left sm:grid-cols-3">
            {[
              ["01", "理解创作意图"],
              ["02", "执行自动化链路"],
              ["03", "交付可发布内容"],
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
    title: "Claude Agent 引擎",
    desc: "把研究、构思、改写和校对交给可追踪的 Agent 任务流。",
    icon: Sparkles,
  },
  {
    title: "Markdown 工艺排版",
    desc: "让长文、代码块、表格和图文内容保持清晰结构。",
    icon: FileText,
  },
  {
    title: "素材与封面管理",
    desc: "把图片、附件和封面归档到同一份内容上下文。",
    icon: Layers3,
  },
  {
    title: "公众号草稿发布",
    desc: "围绕公众号交付链路处理样式、素材与草稿投递。",
    icon: Send,
  },
  {
    title: "用户中心",
    desc: "订单、资料、支持记录和账户状态集中管理。",
    icon: LifeBuoy,
  },
  {
    title: "问题反馈与支持",
    desc: "截图、说明和处理状态在一条记录里闭环。",
    icon: Ticket,
  },
];

function FeaturesSection() {
  return (
    <section id="features" className="min-h-[100svh] scroll-mt-16 border-b bg-white/80">
      <div className="mx-auto flex min-h-[100svh] max-w-7xl items-center px-4 py-14 sm:px-6 md:py-16">
        <div className="w-full">
          <div className="mx-auto max-w-4xl text-center">
            <Badge variant="secondary" className="mb-3">产品能力</Badge>
            <h2 className="text-3xl font-bold tracking-normal md:text-4xl">
              为内容生产而设计，从第一行文字到发布成稿
            </h2>
            <p className="mx-auto mt-3 max-w-3xl text-sm leading-7 text-muted-foreground md:text-base">
              InkPress 把创作、排版、素材、预览、发布和用户支持接起来，让公众号写作不再被工具切换打断。
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

const WORKFLOW = [
  { title: "构思", desc: "让 Agent 帮你把素材、问题和目标整理成清晰方向。", icon: PenLine },
  { title: "生成", desc: "在 Markdown 结构中完成写作、改写和段落整理。", icon: Sparkles },
  { title: "交付", desc: "按公众号草稿与多渠道内容规范输出成稿。", icon: Send },
  { title: "闭环", desc: "订单、支持和使用记录统一回到用户中心。", icon: LifeBuoy },
];

function WorkflowSection() {
  return (
    <section id="workflow" className="min-h-[100svh] scroll-mt-16 border-b bg-[linear-gradient(180deg,#f8fafc_0%,#ffffff_100%)]">
      <div className="mx-auto flex min-h-[100svh] max-w-7xl items-center px-4 py-14 sm:px-6 md:py-16">
        <div className="w-full">
          <div className="mx-auto max-w-4xl text-center">
            <Badge variant="secondary" className="mb-3">工作流</Badge>
            <h2 className="text-3xl font-bold tracking-normal md:text-4xl">
              从灵感到成稿，路径更短
            </h2>
            <p className="mx-auto mt-3 max-w-3xl text-sm leading-7 text-muted-foreground md:text-base">
              首页负责快速理解产品，使用指引负责上手，用户中心负责账号、订单和支持记录，让每个入口都只做用户真正需要的事。
            </p>
          </div>
          <div className="mt-10 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {WORKFLOW.map((item, index) => {
              const Icon = item.icon;
              return (
                <article key={item.title} className="flex min-h-[214px] flex-col rounded-lg border border-slate-200/70 bg-white/[0.88] p-6 shadow-[0_18px_60px_rgba(15,23,42,0.055)]">
                  <div className="flex w-full items-center justify-between">
                    <span className="inline-flex h-11 w-11 items-center justify-center rounded-lg bg-blue-50 text-primary ring-1 ring-blue-100">
                      <Icon className="h-5 w-5" />
                    </span>
                    <span className="font-mono text-xs font-semibold text-muted-foreground">
                      0{index + 1}
                    </span>
                  </div>
                  <h3 className="mt-8 text-lg font-semibold">{item.title}</h3>
                  <p className="mt-3 text-sm leading-7 text-muted-foreground">{item.desc}</p>
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
    <section id="pricing" className="min-h-[100svh] scroll-mt-16 border-b bg-white/80">
      <div className="mx-auto flex min-h-[100svh] max-w-7xl items-center px-4 py-14 sm:px-6 md:py-16">
        <div className="w-full">
          <div className="mx-auto max-w-3xl text-center">
            <Badge variant="warning" className="mb-3">限时折扣</Badge>
            <h2 className="text-3xl font-bold tracking-normal md:text-4xl">
              选择适合你的 InkPress 使用方案
            </h2>
            <p className="mt-3 text-sm text-muted-foreground md:text-base">
              按你的创作频率和使用场景选择方案，购买后可在用户中心查看订单和服务支持。
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

function GuideSection() {
  return (
    <section className="border-b bg-[linear-gradient(180deg,#ffffff_0%,#f8fafc_100%)]">
      <div className="mx-auto grid max-w-7xl gap-8 px-4 py-16 sm:px-6 lg:grid-cols-[1fr_1.1fr] lg:items-center">
        <div>
          <Badge variant="secondary" className="mb-4">使用指引</Badge>
          <h2 className="text-3xl font-bold tracking-normal md:text-4xl">
            文档手册本地维护，目录由 JSON 驱动
          </h2>
          <p className="mt-4 text-base leading-8 text-muted-foreground">
            使用指引聚焦普通用户会遇到的路径：认识产品、开始创作、查看用户中心、提交问题反馈。文档放在本地 `docs/guide`，页面自动渲染 Markdown。
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Button asChild>
              <Link href="/guide">
                <BookOpen className="h-4 w-4" />
                打开使用指引
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/dashboard">
                <Workflow className="h-4 w-4" />
                进入控制台
              </Link>
            </Button>
          </div>
        </div>
        <div className="grid gap-3">
          {[
            ["快速上手", "了解 InkPress 能做什么，以及如何开始第一篇文章。"],
            ["创作工作区", "熟悉写作、排版、素材和发布前预览。"],
            ["用户中心", "查看订单、个人资料和账号安全信息。"],
            ["问题反馈", "用截图和上下文把使用问题说清楚。"],
          ].map(([title, desc]) => (
            <div key={title} className="flex items-start gap-4 rounded-lg border border-slate-200/70 bg-white/[0.88] p-4 shadow-[0_14px_46px_rgba(15,23,42,0.045)]">
              <Ticket className="mt-1 h-4 w-4 shrink-0 text-primary" />
              <div>
                <div className="font-medium">{title}</div>
                <div className="mt-1 text-sm text-muted-foreground">{desc}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

const FAQS = [
  {
    q: "InkPress 适合什么人使用？",
    a: "适合需要长期写公众号、技术文章、产品内容、团队知识库或图文稿件的创作者和内容团队。",
  },
  {
    q: "用户中心能做什么？",
    a: "用户中心用于查看订单、个人资料、账号安全状态和问题反馈记录，帮助你快速找到与自己账户相关的信息。",
  },
  {
    q: "为什么新增使用指引入口？",
    a: "它把产品介绍、上手步骤、用户中心和问题反馈整理成手册，用户不用在首页和控制台之间反复寻找入口。",
  },
  {
    q: "遇到使用问题怎么办？",
    a: "可以在用户中心提交问题反馈，尽量附上操作步骤、截图和错误提示，方便更快定位。",
  },
  {
    q: "支持企业或团队采购吗？",
    a: "支持。可以通过问题反馈或邮件说明团队规模、使用场景和交付要求，我们会按实际情况沟通方案。",
  },
];

function FaqItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left transition-colors hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-none"
      >
        <span className="text-sm font-medium text-foreground">{q}</span>
        <Plus className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-45 text-primary" : ""}`} />
      </button>
      <div className={`grid transition-all duration-200 ${open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}>
        <div className="overflow-hidden">
          <p className="px-5 pb-4 text-sm leading-7 text-muted-foreground">{a}</p>
        </div>
      </div>
    </div>
  );
}

function FaqSection() {
  return (
    <section id="faq" className="border-b">
      <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6 md:py-20">
        <div className="text-center">
          <Badge variant="secondary" className="mb-4">FAQ</Badge>
          <h2 className="text-3xl font-bold tracking-normal md:text-4xl">常见问题</h2>
        </div>
        <div className="mt-8 divide-y divide-border overflow-hidden rounded-lg border bg-card">
          {FAQS.map((faq) => (
            <FaqItem key={faq.q} q={faq.q} a={faq.a} />
          ))}
        </div>
      </div>
    </section>
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
          <Link href="/guide" className="hover:text-foreground">使用指引</Link>
          <Link href="/dashboard" className="hover:text-foreground">控制台</Link>
          <Link href="/dashboard/tickets" className="hover:text-foreground">工单支持</Link>
          <a href="mailto:support@inkpress.app" className="hover:text-foreground">联系我们</a>
        </nav>
      </div>
    </footer>
  );
}
