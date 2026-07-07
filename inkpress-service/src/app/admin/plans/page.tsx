import { listAllPlans } from "@/lib/plan/plan-service";
import type { AdminPlan } from "@/lib/plan/plan-service";
import { PlanEditDialog } from "@/components/admin/plan-edit-dialog";
import { AdminAction } from "@/components/admin/admin-action";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";

function formatYuan(cents: number) {
  return `¥${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;
}

function HighlightBadge({ highlight }: { highlight: string | null }) {
  if (!highlight) return <span className="text-muted-foreground">—</span>;
  if (highlight === "popular") {
    return <Badge variant="default">最受欢迎</Badge>;
  }
  if (highlight === "best_value") {
    return <Badge variant="success">最佳价值</Badge>;
  }
  return <Badge variant="secondary">{highlight}</Badge>;
}

function DurationLabel({ plan }: { plan: AdminPlan }) {
  if (plan.durationKind === "PERMANENT") return "终身";
  if (plan.durationYears) return `${plan.durationYears} 年`;
  switch (plan.durationKind) {
    case "YEAR_1":
      return "1 年";
    case "YEAR_3":
      return "3 年";
    case "YEAR_5":
      return "5 年";
    default:
      return plan.durationKind;
  }
}

export default async function PlansPage() {
  const { items } = await listAllPlans().then((items) => ({ items }));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">订阅计划</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            管理首页价格区展示的订阅方案；修改后首页刷新即生效。
          </p>
        </div>
        <PlanEditDialog mode="create" />
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2">排序</th>
              <th className="px-3 py-2">名称 / slug</th>
              <th className="px-3 py-2">有效期 / 设备</th>
              <th className="px-3 py-2">原价</th>
              <th className="px-3 py-2">折扣价</th>
              <th className="px-3 py-2">省</th>
              <th className="px-3 py-2">今日库存</th>
              <th className="px-3 py-2">亮点</th>
              <th className="px-3 py-2">状态</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && (
              <tr>
                <td colSpan={10} className="px-3 py-8 text-center text-muted-foreground">
                  暂无订阅计划
                </td>
              </tr>
            )}
            {items.map((it) => {
              const save = it.hasDiscount
                ? formatYuan(it.priceCents - (it.discountPriceCents ?? it.priceCents))
                : "—";
              const stockLabel =
                it.dailyStockLimit === null
                  ? "不限"
                  : `${it.dailySoldToday}/${it.dailyStockLimit}`;
              return (
                <tr key={it.id} className="border-t hover:bg-muted/30">
                  <td className="px-3 py-2 font-mono text-xs">{it.sortOrder}</td>
                  <td className="px-3 py-2">
                    <div className="font-medium">{it.name}</div>
                    <div className="font-mono text-xs text-muted-foreground">
                      {it.slug}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-xs">
                    <div>
                      <DurationLabel plan={it} />
                    </div>
                    <div className="text-muted-foreground">
                      {it.maxDevices} 台设备
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    {it.hasDiscount ? (
                      <span className="text-muted-foreground line-through">
                        {formatYuan(it.priceCents)}
                      </span>
                    ) : (
                      <span className="font-medium">
                        {formatYuan(it.priceCents)}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 font-medium text-primary">
                    {it.hasDiscount
                      ? formatYuan(it.discountPriceCents ?? 0)
                      : "—"}
                  </td>
                  <td className="px-3 py-2 text-xs text-emerald-600">
                    {save}
                    {it.hasDiscount && (
                      <span className="ml-1 text-muted-foreground">
                        ({it.discountPct}%)
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {it.dailyStockLimit === null ? (
                      <span className="text-muted-foreground">{stockLabel}</span>
                    ) : it.soldOut ? (
                      <Badge variant="destructive">售罄 {stockLabel}</Badge>
                    ) : (
                      <Badge
                        variant={
                          (it.dailyRemaining ?? 0) <= 1 ? "warning" : "secondary"
                        }
                      >
                        剩 {it.dailyRemaining} · {stockLabel}
                      </Badge>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <HighlightBadge highlight={it.highlight} />
                  </td>
                  <td className="px-3 py-2">
                    <Badge variant={it.status === "ACTIVE" ? "success" : "warning"}>
                      {it.status === "ACTIVE" ? "上架" : "下架"}
                    </Badge>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1">
                      <PlanEditDialog mode="edit" plan={it} />
                      {it.dailyStockLimit !== null && (
                        <AdminAction
                          label="重置库存"
                          href={`/api/admin/plans/${it.id}/reset-stock`}
                          method="POST"
                          body={{}}
                          size="sm"
                          variant="outline"
                        />
                      )}
                      <AdminAction
                        label={it.status === "ACTIVE" ? "下架" : "上架"}
                        href={`/api/admin/plans/${it.id}`}
                        method="PATCH"
                        body={{
                          status: it.status === "ACTIVE" ? "INACTIVE" : "ACTIVE",
                        }}
                        size="sm"
                        variant="outline"
                      />
                      <AdminAction
                        label="删除"
                        href={`/api/admin/plans/${it.id}`}
                        method="DELETE"
                        confirmText={`确认删除「${it.name}」？此操作不可恢复。`}
                        size="sm"
                        variant="destructive"
                      />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
