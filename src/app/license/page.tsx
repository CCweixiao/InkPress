import Link from "next/link";
import Image from "next/image";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LicensePanel } from "@/components/license/LicensePanel";

export const dynamic = "force-dynamic";

export default function LicensePage() {
  return (
    <div className="min-h-screen">
      <header className="border-b border-border bg-background/80 backdrop-blur sticky top-0 z-40">
        <div className="mx-auto max-w-4xl px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4" />
              返回
            </Link>
            <span className="text-muted-foreground/40">/</span>
            <div className="flex items-center gap-2">
              <Image src="/inkpress-logo-transparent.png" alt="InkPress" width={28} height={28} priority />
              <span className="font-semibold">License 激活</span>
            </div>
          </div>
          <Button asChild variant="ghost" size="sm">
            <Link href="/settings">设置</Link>
          </Button>
        </div>
      </header>
      <main className="mx-auto max-w-4xl px-6 py-8">
        <LicensePanel />
      </main>
    </div>
  );
}

