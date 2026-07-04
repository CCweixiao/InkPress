import { auth } from "@/auth";
import { listPublicPlans } from "@/lib/plan/plan-service";
import { HomePage } from "@/components/home/home-page";

/**
 * 首页：公开访问，无需登录。
 *
 * 已登录用户在头部展示「进入控制台」入口；未登录展示「登录 / 立即购买」。
 * 价格数据从 SubscriptionPlan 表读取，由管理员在 /admin/plans 维护。
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
      }))}
    />
  );
}
