import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Geist, Geist_Mono } from "next/font/google";
import "katex/dist/katex.min.css";
import "./globals.css";
import { ThemeProvider } from "@/components/theme/ThemeProvider";
import {
  parseThemeMode,
  themeModeToHtmlClass,
  THEME_STORAGE_KEY,
} from "@/lib/theme-mode";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "InkPress · 数字文刊工坊",
  description: "AI 驱动的公众号文章编写与发布系统：生成、排版、一键推送草稿箱",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const cookieStore = await cookies();
  const themeMode = parseThemeMode(cookieStore.get(THEME_STORAGE_KEY)?.value);
  const themeClass = themeModeToHtmlClass(themeMode);

  return (
    <html
      lang="zh-CN"
      className={[
        geistSans.variable,
        geistMono.variable,
        "h-full antialiased",
        themeClass,
      ]
        .filter(Boolean)
        .join(" ")}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
