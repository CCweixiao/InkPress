"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { AdminPlan } from "@/lib/plan/plan-service";

interface PlanEditDialogProps {
  mode: "create" | "edit";
  plan?: AdminPlan;
}

const DURATIONS = [
  { value: "YEAR_1", label: "1 年", years: 1 },
  { value: "YEAR_3", label: "3 年", years: 3 },
  { value: "YEAR_5", label: "5 年", years: 5 },
  { value: "PERMANENT", label: "终身", years: null },
];

const HIGHLIGHTS = [
  { value: "", label: "无" },
  { value: "popular", label: "最受欢迎" },
  { value: "best_value", label: "最佳价值" },
];

/**
 * 元 ↔ 分转换：表单输入按元，提交时 ×100 取整。
 * 元输入允许小数（最多 2 位），分作为存储单位。
 */
function yuanToCents(yuan: string): number | null {
  const n = Number(yuan);
  if (!Number.isFinite(n) || n < 0.01) return null;
  return Math.round(n * 100);
}

function centsToYuan(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "";
  return (cents / 100).toString();
}

export function PlanEditDialog({ mode, plan }: PlanEditDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  // 字段（create 与 edit 共用一套 state，edit 模式初值取 plan）
  const [slug, setSlug] = useState(plan?.slug ?? "");
  const [name, setName] = useState(plan?.name ?? "");
  const [tagline, setTagline] = useState(plan?.tagline ?? "");
  const [durationKind, setDurationKind] = useState(
    plan?.durationKind ?? "YEAR_1"
  );
  const [maxDevices, setMaxDevices] = useState(String(plan?.maxDevices ?? 1));
  const [priceYuan, setPriceYuan] = useState(
    centsToYuan(plan?.priceCents) || "99"
  );
  const [discountYuan, setDiscountYuan] = useState(
    centsToYuan(plan?.discountPriceCents) || "69"
  );
  const [features, setFeatures] = useState<string>(
    (plan ? plan.features : []).join("\n")
  );
  const [highlight, setHighlight] = useState(plan?.highlight ?? "");
  const [sortOrder, setSortOrder] = useState(String(plan?.sortOrder ?? 1));
  const [status, setStatus] = useState(plan?.status ?? "ACTIVE");
  // 每日库存上限：空字符串 = 不限；数字 = 上限
  const [dailyStockLimit, setDailyStockLimit] = useState<string>(
    plan?.dailyStockLimit === null || plan?.dailyStockLimit === undefined
      ? ""
      : String(plan.dailyStockLimit)
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setError(null);
    setSubmitting(false);
  }

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      if (mode === "edit") router.refresh();
      reset();
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const priceCents = yuanToCents(priceYuan);
    const discountCents = discountYuan.trim()
      ? yuanToCents(discountYuan)
      : null;

    if (!priceCents) {
      setError("原价格式错误（元）");
      return;
    }
    if (discountCents !== null && discountCents >= priceCents) {
      setError("折扣价必须低于原价");
      return;
    }

    const featureList = features
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);

    const payload: Record<string, unknown> = {
      name: name.trim(),
      tagline: tagline.trim() || null,
      durationKind,
      maxDevices: Number(maxDevices),
      priceCents,
      discountPriceCents: discountCents,
      features: featureList,
      highlight: highlight || null,
      sortOrder: Number(sortOrder),
      status,
      dailyStockLimit: dailyStockLimit.trim() === "" ? null : Number(dailyStockLimit),
    };
    if (mode === "create") {
      payload.slug = slug.trim();
    }

    setSubmitting(true);
    try {
      const url =
        mode === "create"
          ? "/api/admin/plans"
          : `/api/admin/plans/${plan?.id}`;
      const method = mode === "create" ? "POST" : "PATCH";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data?.error?.message ?? "保存失败");
        return;
      }
      onOpenChange(false);
    } catch {
      setError("网络错误");
    } finally {
      setSubmitting(false);
    }
  }

  const trigger =
    mode === "create" ? (
      <Button>新增计划</Button>
    ) : (
      <Button variant="outline" size="sm">
        编辑
      </Button>
    );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {mode === "create" ? "新增订阅计划" : `编辑：${plan?.name}`}
          </DialogTitle>
          <DialogDescription>
            价格以元输入，存储为分；特性一行一条；折扣价留空表示无折扣。
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid grid-cols-2 gap-3">
          {mode === "create" && (
            <div className="col-span-2 space-y-1.5">
              <Label htmlFor="slug">slug（唯一标识，创建后不可改）</Label>
              <Input
                id="slug"
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                placeholder="year_1 / lifetime 等"
                required
                pattern="[a-z0-9_]+"
              />
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="name">名称</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="1年版 / 终身版"
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sortOrder">排序（小→前）</Label>
            <Input
              id="sortOrder"
              type="number"
              min={0}
              max={9999}
              value={sortOrder}
              onChange={(e) => setSortOrder(e.target.value)}
              required
            />
          </div>
          <div className="col-span-2 space-y-1.5">
            <Label htmlFor="tagline">副标题（可选）</Label>
            <Input
              id="tagline"
              value={tagline}
              onChange={(e) => setTagline(e.target.value)}
              placeholder="卡片副标题，例如「最适合个人创作者」"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="dk">有效期模板</Label>
            <select
              id="dk"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={durationKind}
              onChange={(e) => setDurationKind(e.target.value)}
            >
              {DURATIONS.map((d) => (
                <option key={d.value} value={d.value}>
                  {d.label}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="md">设备数上限</Label>
            <Input
              id="md"
              type="number"
              min={1}
              max={100}
              value={maxDevices}
              onChange={(e) => setMaxDevices(e.target.value)}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="price">原价（元）</Label>
            <Input
              id="price"
              type="number"
              min={0.01}
              step={0.01}
              value={priceYuan}
              onChange={(e) => setPriceYuan(e.target.value)}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="discount">折扣价（元，可空）</Label>
            <Input
              id="discount"
              type="number"
              min={0.01}
              step={0.01}
              value={discountYuan}
              onChange={(e) => setDiscountYuan(e.target.value)}
              placeholder="留空 = 无折扣"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="hl">亮点徽章</Label>
            <select
              id="hl"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={highlight}
              onChange={(e) => setHighlight(e.target.value)}
            >
              {HIGHLIGHTS.map((h) => (
                <option key={h.value} value={h.value}>
                  {h.label}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="status">状态</Label>
            <select
              id="status"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              <option value="ACTIVE">上架</option>
              <option value="INACTIVE">下架</option>
            </select>
          </div>
          <div className="col-span-2 space-y-1.5">
            <Label htmlFor="features">特性列表（一行一条，最多 20 条）</Label>
            <textarea
              id="features"
              value={features}
              onChange={(e) => setFeatures(e.target.value)}
              rows={6}
              placeholder={"全部功能解锁\n3 台设备授权\n优先邮件客服"}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
          </div>
          <div className="col-span-2 space-y-1.5 rounded-md border border-amber-500/30 bg-amber-50/50 p-3 dark:bg-amber-950/10">
            <Label htmlFor="dailyStockLimit">每日库存上限</Label>
            <Input
              id="dailyStockLimit"
              type="number"
              min={0}
              max={100000}
              value={dailyStockLimit}
              onChange={(e) => setDailyStockLimit(e.target.value)}
              placeholder="留空 = 不限；0 = 停售；正整数 = 每日可售件数"
            />
            <p className="text-xs text-muted-foreground">
              防止触发支付宝小微商户单日收款限额（默认 ≤1000 元/日）。每日 0 点自动重置。
            </p>
          </div>
          {error && (
            <p className="col-span-2 text-sm text-destructive">{error}</p>
          )}
          <DialogFooter className="col-span-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              取消
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? "保存中…" : "保存"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** 预览徽章（保留导出便于其他页面复用） */
export function HighlightPreview({ value }: { value: string }) {
  if (!value) return null;
  if (value === "popular") return <Badge variant="default">最受欢迎</Badge>;
  if (value === "best_value") return <Badge variant="success">最佳价值</Badge>;
  return null;
}
