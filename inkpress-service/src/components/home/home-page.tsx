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
    <div className="min-h-screen bg-background text-foreground">
      <ServiceHeader isLoggedIn={isLoggedIn} email={email} role={role} />
      <HeroSection isLoggedIn={isLoggedIn} role={role} />
      <TrustBar />
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
  return (
    <section className="relative min-h-[78vh] overflow-hidden border-b bg-[#111827] text-white">
      <Image
        src="/assets/inkpress-hero-workflow.png"
        alt="InkPress 数字内容工作流界面"
        fill
        className="object-cover object-center"
        priority
        sizes="100vw"
      />
      <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(2,6,23,0.92)_0%,rgba(2,6,23,0.78)_34%,rgba(2,6,23,0.32)_68%,rgba(2,6,23,0.12)_100%)]" />
      <div className="relative mx-auto flex min-h-[78vh] max-w-7xl items-center px-4 py-16 sm:px-6">
        <div className="max-w-3xl">
          <Badge className="mb-5 border border-white/12 bg-white/10 text-white">
            面向公众号与专业内容团队的数字文刊工坊
          </Badge>
          <h1 className="text-balance text-5xl font-bold leading-[1.04] tracking-normal md:text-7xl">
            InkPress
          </h1>
          <p className="mt-6 max-w-2xl text-pretty text-lg leading-8 text-slate-200 md:text-xl">
            从 AI 辅助创作、Markdown 排版、素材管理到公众号草稿发布，
            为内容创作者构建一条清晰、稳定、专业的内容生产工作流。
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Button asChild size="lg">
              <Link href={isLoggedIn ? (role === "ADMIN" ? "/admin" : "/dashboard") : "/register"}>
                {isLoggedIn ? "进入工作区" : "免费注册"}
                <ChevronRight className="h-4 w-4" />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline" className="border-white/30 bg-white/10 text-white hover:bg-white/16 hover:text-white">
              <Link href="/guide">
                <BookOpen className="h-4 w-4" />
                使用指引
              </Link>
            </Button>
          </div>
          <div className="mt-8 grid max-w-2xl gap-3 text-sm text-slate-200 sm:grid-cols-3">
            <HeroMetric value="全流程" label="写作到发布一站完成" />
            <HeroMetric value="Markdown" label="结构化写作排版" />
            <HeroMetric value="用户中心" label="订单与支持集中管理" />
          </div>
        </div>
      </div>
    </section>
  );
}

function HeroMetric({ value, label }: { value: string; label: string }) {
  return (
    <div className="border-l border-white/24 pl-3">
      <div className="font-semibold text-white">{value}</div>
      <div className="mt-1 text-xs text-slate-300">{label}</div>
    </div>
  );
}

function TrustBar() {
  return (
    <section className="border-b bg-muted/30">
      <div className="mx-auto grid max-w-7xl gap-3 px-4 py-5 text-sm text-muted-foreground sm:px-6 md:grid-cols-4">
        {[
          ["专注创作", "把选题、写作、排版和发布收进同一套工作流"],
          ["账户清晰", "登录后可统一管理订单、资料和服务支持"],
          ["专业排版", "Markdown、素材、封面、发布流程面向公众号场景优化"],
          ["支持闭环", "使用问题、截图附件和回复记录集中追踪"],
        ].map(([title, desc]) => (
          <div key={title} className="rounded-lg border bg-card px-4 py-3">
            <div className="font-medium text-foreground">{title}</div>
            <div className="mt-1 text-xs leading-5">{desc}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

const FEATURES = [
  {
    title: "AI 写作与选题辅助",
    desc: "围绕公众号、技术文、产品稿等内容类型，辅助生成提纲、润色标题、补全段落和整理摘要。",
    icon: Sparkles,
  },
  {
    title: "Markdown 排版工作流",
    desc: "面向长文、代码块、表格和图文混排设计，让创作和交付保持同一份结构化内容。",
    icon: FileText,
  },
  {
    title: "素材与封面管理",
    desc: "图片、附件、文章素材归档到内容项目，减少重复上传和跨工具寻找素材的时间。",
    icon: Layers3,
  },
  {
    title: "公众号草稿发布",
    desc: "围绕微信公众号发布链路整理样式、素材和草稿投递，降低复制粘贴造成的格式损耗。",
    icon: Send,
  },
  {
    title: "用户中心",
    desc: "登录后集中查看订单、个人资料、服务支持记录和账户安全状态，减少来回跳转。",
    icon: LifeBuoy,
  },
  {
    title: "问题反馈与支持",
    desc: "遇到使用问题时可以提交说明和截图，跟进回复和处理状态，不再散落在不同沟通渠道。",
    icon: Ticket,
  },
];

function FeaturesSection() {
  return (
    <section id="features" className="border-b">
      <div className="mx-auto max-w-7xl px-4 pb-14 pt-12 sm:px-6 md:pb-20 md:pt-16">
        <div className="max-w-3xl">
          <Badge variant="secondary" className="mb-3">产品能力</Badge>
          <h2 className="text-3xl font-bold tracking-normal md:text-4xl">
            为内容生产而设计，从第一行文字到发布成稿
          </h2>
          <p className="mt-3 text-sm leading-7 text-muted-foreground md:text-base">
            InkPress 把创作、排版、素材、预览、发布和用户支持接起来，让公众号写作不再被工具切换打断。
          </p>
        </div>
        <div className="mt-7 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((feature) => {
            const Icon = feature.icon;
            return (
              <article key={feature.title} className="rounded-lg border bg-card p-5 transition-shadow hover:shadow-md">
                <div className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Icon className="h-5 w-5" />
                </div>
                <h3 className="text-lg font-semibold">{feature.title}</h3>
                <p className="mt-2 text-sm leading-7 text-muted-foreground">{feature.desc}</p>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}

const WORKFLOW = [
  { title: "创作", desc: "在桌面端完成选题、写作、Markdown 排版和素材整理。", icon: PenLine },
  { title: "整理", desc: "把封面、配图、附件和文章结构归档到同一套内容空间。", icon: Layers3 },
  { title: "发布", desc: "按公众号草稿和多渠道内容规范交付成稿。", icon: Send },
  { title: "管理", desc: "在用户中心查看订单、个人资料和服务支持记录。", icon: LifeBuoy },
];

function WorkflowSection() {
  return (
    <section id="workflow" className="border-b bg-muted/30">
      <div className="mx-auto max-w-7xl px-4 pb-14 pt-12 sm:px-6 md:pb-20 md:pt-16">
        <div className="grid gap-8 lg:grid-cols-[0.82fr_1.18fr] lg:items-start">
          <div>
            <Badge variant="secondary" className="mb-3">工作流</Badge>
            <h2 className="text-3xl font-bold tracking-normal md:text-4xl">
              从灵感到成稿，路径更短
            </h2>
            <p className="mt-3 text-sm leading-7 text-muted-foreground md:text-base">
              首页负责快速理解产品，使用指引负责上手，用户中心负责账号、订单和支持记录，让每个入口都只做用户真正需要的事。
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {WORKFLOW.map((item, index) => {
              const Icon = item.icon;
              return (
                <article key={item.title} className="rounded-lg border bg-card p-5">
                  <div className="mb-4 flex items-center justify-between">
                    <Icon className="h-5 w-5 text-primary" />
                    <span className="font-mono text-xs text-muted-foreground">
                      0{index + 1}
                    </span>
                  </div>
                  <h3 className="font-semibold">{item.title}</h3>
                  <p className="mt-2 text-sm leading-7 text-muted-foreground">{item.desc}</p>
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
    <section id="pricing" className="border-b">
      <div className="mx-auto max-w-7xl px-4 pb-12 pt-10 sm:px-6 md:pb-16 md:pt-12">
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
          <div className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {plans.map((plan) => (
              <PlanCard key={plan.slug} plan={plan} isLoggedIn={isLoggedIn} />
            ))}
          </div>
        )}
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
    <article className={`relative flex flex-col rounded-lg border bg-card p-5 shadow-sm transition-shadow ${isInactive ? "" : "hover:shadow-md"} ${ringClass}`}>
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
        asChild={!isInactive}
        disabled={isInactive}
        className="mt-auto"
        variant={isHighlighted ? "default" : "outline"}
      >
        {isInactive ? <span>已下架 · 暂停售卖</span> : <Link href={ctaHref}>选择{plan.name}</Link>}
      </Button>
    </article>
  );
}

function GuideSection() {
  return (
    <section className="border-b bg-muted/30">
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
            <div key={title} className="flex items-start gap-4 rounded-lg border bg-card p-4">
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
