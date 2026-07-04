import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { GuideView } from "@/components/guide/guide-view";
import { getGuideDocument } from "@/lib/guide";
import { renderGuideMarkdown } from "@/lib/guide-markdown";

export const metadata: Metadata = {
  title: "InkPress 使用指引 · 账号、License、控制台与工单手册",
  description:
    "InkPress Service 使用指引，包含账号注册、订阅购买、License 激活、用户控制台、订单、工单和管理后台说明。",
  alternates: { canonical: "/guide" },
};

export default async function GuidePage() {
  const [session, guide] = await Promise.all([auth(), getGuideDocument()]);
  if (!guide) notFound();

  return (
    <GuideView
      manifest={guide.manifest}
      current={guide.item}
      html={renderGuideMarkdown(guide.markdown)}
      isLoggedIn={Boolean(session?.user?.id)}
      email={session?.user?.email ?? null}
      role={session?.user?.role ?? null}
    />
  );
}
