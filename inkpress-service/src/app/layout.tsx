import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "InkPress Service",
  description: "InkPress 用户服务、认证与 License 管理",
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
