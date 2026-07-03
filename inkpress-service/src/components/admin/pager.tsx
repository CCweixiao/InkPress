import Link from "next/link";
import { cn } from "@/lib/utils";

interface PagerProps {
  page: number;
  pageSize: number;
  total: number;
  basePath: string;
  searchParams: Record<string, string | undefined>;
}

export function Pager({ page, pageSize, total, basePath, searchParams }: PagerProps) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) {
    return (
      <div className="text-sm text-muted-foreground">共 {total} 条</div>
    );
  }
  const href = (p: number) => {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(searchParams)) if (v) sp.set(k, v);
    sp.set("page", String(Math.min(Math.max(1, p), pages)));
    return `${basePath}?${sp.toString()}`;
  };
  return (
    <div className="flex items-center gap-3 text-sm">
      <Link
        href={href(page - 1)}
        className={cn(
          "rounded-md border px-3 py-1",
          page <= 1 && "pointer-events-none opacity-40"
        )}
      >
        上一页
      </Link>
      <span className="text-muted-foreground">
        {page} / {pages}（共 {total}）
      </span>
      <Link
        href={href(page + 1)}
        className={cn(
          "rounded-md border px-3 py-1",
          page >= pages && "pointer-events-none opacity-40"
        )}
      >
        下一页
      </Link>
    </div>
  );
}
