import type { Metadata } from "next";
import "./globals.css";

export const dynamic = "force-dynamic";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://inkpress.app";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "InkPress · AI 公众号写作排版与 License 授权服务",
    template: "%s · InkPress",
  },
  description:
    "InkPress 是面向内容创作者和团队的公众号写作、Markdown 排版、素材管理、AI 辅助创作与多端授权服务。",
  keywords: [
    "InkPress",
    "公众号排版工具",
    "AI 写作工具",
    "Markdown 编辑器",
    "微信文章排版",
    "内容发布工具",
    "License 授权管理",
    "创作者工具",
  ],
  authors: [{ name: "InkPress" }],
  creator: "InkPress",
  publisher: "InkPress",
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    locale: "zh_CN",
    url: siteUrl,
    siteName: "InkPress",
    title: "InkPress · AI 公众号写作排版与授权服务",
    description:
      "从写作、排版、素材管理到公众号发布与 License 授权，InkPress 帮助创作者建立专业内容生产工作流。",
    images: [
      {
        url: "/assets/inkpress-hero-workflow.png",
        width: 1680,
        height: 945,
        alt: "InkPress 数字内容工作流",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "InkPress · AI 公众号写作排版与授权服务",
    description:
      "面向内容创作者的写作、排版、素材管理、多端发布和 License 授权服务。",
    images: ["/assets/inkpress-hero-workflow.png"],
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <body className="min-h-screen bg-background text-foreground antialiased">
        {children}
      </body>
    </html>
  );
}
