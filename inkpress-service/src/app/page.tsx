import { auth } from "@/auth";
import { listPublicPlans } from "@/lib/plan/plan-service";
import { HomePage } from "@/components/home/home-page";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "InkPress · AI 公众号写作排版、Markdown 编辑与内容发布工具",
  description:
    "InkPress 为公众号创作者和内容团队提供 AI 写作、Markdown 排版、素材管理、文章预览、草稿发布、用户中心和问题反馈支持。",
  keywords: [
    "公众号写作工具",
    "公众号排版",
    "AI 写作",
    "Markdown 排版",
    "微信图文编辑器",
    "用户中心",
    "内容创作者工具",
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
