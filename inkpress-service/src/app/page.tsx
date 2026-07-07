import { auth } from "@/auth";
import { listPublicPlans } from "@/lib/plan/plan-service";
import { HomePage } from "@/components/home/home-page";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "InkPress · 数字文刊工坊 — AI 数字媒体创作与多渠道作品发布工具",
  description:
    "InkPress 数字文刊工坊为数字媒体创作者和内容团队提供 AI 写作、素材管理、作品预览、多渠道发布，以及图文、种草、小说、短剧脚本和 AI 视频创意生成能力。",
  keywords: [
    "数字媒体创作",
    "AI 内容创作",
    "AI 写作",
    "小红书种草文案",
    "小说创作",
    "短剧剧本",
    "AI 视频生成",
    "多渠道发布",
  ],
  alternates: { canonical: "/" },
};

/**
 * 首页：公开访问，无需登录。
 *
 * 已登录用户在头部展示「进入控制台」入口；未登录展示「登录 / 立即购买」。
 * 价格数据从 SubscriptionPlan 表读取。
 */
export default async function Home() {
  const session = await auth();
  const plans = await listPublicPlans();

  return (
    <HomePage
      isLoggedIn={Boolean(session?.user?.id)}
      email={session?.user?.email ?? null}
      role={session?.user?.role ?? null}
      plans={plans.map((p) => ({
        slug: p.slug,
        name: p.name,
        tagline: p.tagline,
        durationKind: p.durationKind,
        durationYears: p.durationYears,
        maxDevices: p.maxDevices,
        priceYuan: p.priceYuan,
        discountYuan: p.discountYuan,
        hasDiscount: p.hasDiscount,
        discountPct: p.discountPct,
        saveYuan: p.saveYuan,
        perYearYuan: p.perYearYuan,
        features: p.features,
        highlight: p.highlight,
        sortOrder: p.sortOrder,
        status: p.status,
        dailyStockLimit: p.dailyStockLimit,
        dailyRemaining: p.dailyRemaining,
        soldOut: p.soldOut,
      }))}
    />
  );
}
