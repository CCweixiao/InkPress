import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { CheckoutClient, type CheckoutPlan } from "@/components/payment/checkout-client";

/**
 * /checkout?plan=SLUG — 收银台（Server Component）。
 *
 * 未登录 → /login?callbackUrl=/checkout?plan=SLUG
 * 套餐不存在/未 ACTIVE → notFound()
 * 校验通过 → 渲染 CheckoutClient（mount 时 POST /api/orders 创建订单）
 */
export default async function CheckoutPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const planSlug = sp.plan;
  if (!planSlug) {
    redirect("/");
  }

  const session = await auth();
  if (!session?.user?.id || !session.user.email) {
    const cb = `/checkout?plan=${encodeURIComponent(planSlug)}`;
    redirect(`/login?callbackUrl=${encodeURIComponent(cb)}`);
  }

  const plan = await prisma.subscriptionPlan.findFirst({
    where: { slug: planSlug, status: "ACTIVE" },
    select: {
      id: true,
      slug: true,
      name: true,
      tagline: true,
      durationKind: true,
      durationYears: true,
      maxDevices: true,
      priceCents: true,
      discountPriceCents: true,
    },
  });
  if (!plan) {
    redirect("/");
  }

  const checkoutPlan: CheckoutPlan = {
    slug: plan.slug,
    name: plan.name,
    tagline: plan.tagline,
    durationKind: plan.durationKind,
    durationYears: plan.durationYears,
    maxDevices: plan.maxDevices,
    priceCents: plan.discountPriceCents ?? plan.priceCents,
  };

  return <CheckoutClient plan={checkoutPlan} userEmail={session.user.email} />;
}
