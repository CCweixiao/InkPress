import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { GuideView } from "@/components/guide/guide-view";
import { getGuideDocument } from "@/lib/guide";
import { renderGuideMarkdown } from "@/lib/guide-markdown";

export const metadata: Metadata = {
  title: "InkPress 使用指引 · 产品上手、用户中心与问题反馈",
  description:
    "InkPress 使用指引，包含产品上手、创作工作区、用户中心、订单查看、账号设置和问题反馈说明。",
  alternates: { canonical: "/guide" },
};

export default async function GuidePage() {
  const [session, guide] = await Promise.all([auth(), getGuideDocument()]);
  if (!guide) notFound();

  const { html, toc } = renderGuideMarkdown(guide.markdown);

  return (
    <GuideView
      manifest={guide.manifest}
      current={guide.item}
      html={html}
      toc={toc}
      isLoggedIn={Boolean(session?.user?.id)}
      email={session?.user?.email ?? null}
      role={session?.user?.role ?? null}
    />
  );
}
