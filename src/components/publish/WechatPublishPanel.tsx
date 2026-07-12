"use client";

import { useEffect, useState } from "react";
import { Send, Loader2, ImagePlus, ImageIcon, Library } from "lucide-react";
import {
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import type { ThemeOption } from "@/components/editor/EditorWorkspace";
import { PublishPreview } from "./PublishPreview";
import {
  Dialog,
  DialogContent,
  DialogDescription as PickerDialogDescription,
  DialogHeader as PickerDialogHeader,
  DialogTitle as PickerDialogTitle,
} from "@/components/ui/dialog";
import type { Asset } from "@/types/asset";

/**
 * 微信公众号发布面板（api-push 渠道）。
 *
 * 从原 PublishDialog 抽出的核心逻辑：摘要/封面/主题选择 + 推送草稿箱。
 * 不含外层 Dialog——由 PublishEntryDialog 提供 Dialog 容器，本组件作为其内容。
 * 「关闭」= onClose（关闭整个发布弹窗）；返回渠道选择由 PublishEntryDialog 顶栏统一处理。
 */
export function WechatPublishPanel({
  articleId,
  title,
  digest,
  coverMediaId,
  status,
  themes,
  defaultThemeId,
  onClose,
}: {
  articleId: string;
  title: string;
  digest: string;
  coverMediaId: string | null;
  status: string;
  themes: ThemeOption[];
  defaultThemeId: string | null;
  onClose: () => void;
}) {
  const [summary, setSummary] = useState(digest);
  const [themeId, setThemeId] = useState<string>(
    defaultThemeId ?? themes[0]?.id ?? ""
  );
  const [cover, setCover] = useState<string | null>(coverMediaId);
  const [coverUploading, setCoverUploading] = useState(false);
  const [coverPickerOpen, setCoverPickerOpen] = useState(false);
  const [coverAssets, setCoverAssets] = useState<Asset[]>([]);
  const [coverAssetsLoading, setCoverAssetsLoading] = useState(false);
  const [selectingAssetId, setSelectingAssetId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [resultMeta, setResultMeta] = useState<{
    mediaId?: string;
    updated?: boolean;
  } | null>(null);
  const [failedImages, setFailedImages] = useState<
    { url: string; reason: string }[]
  >([]);
  const [error, setError] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<Array<{id:string;name:string;isDefault:boolean;status:string}>>([]);
  const [accountId, setAccountId] = useState("");
  useEffect(() => { fetch("/api/wechat/accounts").then(r=>r.json()).then(d => { const list=d.accounts??[]; setAccounts(list); setAccountId((list.find((x: {isDefault:boolean})=>x.isDefault)??list[0])?.id??""); }).catch(()=>{}); }, []);

  useEffect(() => {
    if (!coverPickerOpen) return;
    let active = true;
    setCoverAssetsLoading(true);
    fetch(`/api/materials?kind=image${accountId ? `&wechatAccountId=${encodeURIComponent(accountId)}` : ""}`)
      .then((response) => response.json())
      .then((data) => {
        if (active) setCoverAssets(Array.isArray(data.assets) ? data.assets : []);
      })
      .catch(() => {
        if (active) setError("素材库图片加载失败，请稍后重试。");
      })
      .finally(() => {
        if (active) setCoverAssetsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [coverPickerOpen, accountId]);

  async function handleUploadCover(file: File) {
    setCoverUploading(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("articleId", articleId);
      const response = await fetch("/api/wechat/cover", { method: "POST", body: form });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.mediaId) {
        throw new Error(data.error || "封面上传失败");
      }
      setCover(data.mediaId);
      // 只有微信上传、本地素材入库、文章绑定三步都成功，服务端才返回成功。
      setCoverAssets((current) =>
        data.asset && !current.some((asset) => asset.id === data.asset.id)
          ? [data.asset as Asset, ...current]
          : current
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "封面上传失败");
    } finally {
      setCoverUploading(false);
    }
  }

  async function handleSelectCoverAsset(asset: Asset) {
    setSelectingAssetId(asset.id);
    setError(null);
    try {
      const response = await fetch("/api/wechat/cover", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ articleId, assetId: asset.id }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.mediaId) {
        throw new Error(data.error || "设置素材库封面失败");
      }
      setCover(data.mediaId);
      setCoverPickerOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "设置素材库封面失败");
    } finally {
      setSelectingAssetId(null);
    }
  }

  async function handlePublish() {
    setLoading(true);
    setError(null);
    setResult(null);
    setFailedImages([]);
    if (!cover) {
      setError("请先上传封面图");
      setLoading(false);
      return;
    }
    if (!accountId) { setError("请先在设置中添加并选择一个公众号。"); setLoading(false); return; }
    if (cover === "__oss_only__") {
      setError(
        "封面仅存到素材库，缺少微信 media_id，无法推送草稿箱。请在公众号「基本配置 → IP白名单」加入当前出口 IP 后重新上传封面。"
      );
      setLoading(false);
      return;
    }
    try {
      // 先保存摘要/主题/封面到文章
      await fetch(`/api/articles/${articleId}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          digest: summary,
          themeId,
          coverMediaId: cover,
          status: "ready",
        }),
      });
      // 推送草稿箱
      const res = await fetch("/api/wechat/draft", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ articleId, themeId, digest: summary, accountId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "推送失败");
      setResult(
        data.updated
          ? `已更新公众号草稿箱中的文章（草稿未新增，原草稿内容已覆盖为最新）`
          : `已新增到公众号草稿箱`
      );
      setResultMeta({ mediaId: data.mediaId, updated: !!data.updated });
      setFailedImages(Array.isArray(data.failedImages) ? data.failedImages : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "推送失败");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>发布到公众号草稿箱</DialogTitle>
        <DialogDescription>
          选择排版主题，确认后将文章转为公众号格式并推送至草稿箱（发布需在公众号后台手动操作）。
        </DialogDescription>
      </DialogHeader>

      {result ? (
        <div className="space-y-4">
          <div className="rounded-md bg-emerald-50 border border-emerald-200 p-4 space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium text-emerald-700">
              <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-emerald-600 text-white">
                ✓
              </span>
              {resultMeta?.updated ? "草稿已更新" : "草稿已新增"}
            </div>
            <p className="text-xs text-emerald-700/90 leading-relaxed pl-8">
              {result}
            </p>
            <div className="pl-8 space-y-1 text-[11px] text-emerald-700/70">
              <div>
                文章：<span className="font-medium">{title || "无标题文章"}</span>
              </div>
              {resultMeta?.mediaId && (
                <div className="truncate">
                  草稿 media_id：
                  <code className="px-1 py-0.5 rounded bg-emerald-100">
                    {resultMeta.mediaId}
                  </code>
                </div>
              )}
            </div>
            {failedImages.length > 0 && (
              <div className="mt-2 ml-8 rounded-md bg-amber-50 border border-amber-200 p-3 space-y-1.5">
                <div className="text-xs font-medium text-amber-800">
                  ⚠ {failedImages.length} 张图片上传失败，草稿中将以原链接展示（公众号可能因防盗链显示裂图）
                </div>
                <ul className="text-[11px] text-amber-700/90 space-y-0.5 max-h-32 overflow-y-auto">
                  {failedImages.map((f, i) => (
                    <li key={i} className="break-all">
                      <span className="text-amber-600">•</span>{" "}
                      <span className="text-amber-500">{f.reason}：</span>
                      {f.url}
                    </li>
                  ))}
                </ul>
                <div className="text-[11px] text-amber-700/80 pt-1">
                  常见原因：图片源防盗链/需授权、网络超时、超过 10MB、或本地占位未上传。请修复后重新推送。
                </div>
              </div>
            )}
            <a
              href="https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_edit&action=edit&type=77&lang=zh_CN"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-emerald-700 hover:underline pl-8"
            >
              → 前往公众号草稿箱查看
            </a>
          </div>
          <div className="text-xs text-muted-foreground pl-1">
            提示：草稿箱的文章还需在公众号后台「群发」才会正式发布给粉丝。
          </div>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setResult(null);
                setResultMeta(null);
                setFailedImages([]);
                onClose();
              }}
            >
              关闭
            </Button>
            <Button
              onClick={() => {
                setResult(null);
                setResultMeta(null);
                setFailedImages([]);
              }}
            >
              继续编辑
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {status === "pushed" && (
            <div className="rounded-md bg-blue-50 border border-blue-200 px-3 py-2 text-xs text-blue-700">
              该文章已推送过草稿箱，本次将<span className="font-medium">更新</span>公众号中对应的草稿（覆盖修改），不会产生重复草稿。
            </div>
          )}
          <div className="space-y-1.5">
            <Label>文章标题</Label>
            <Input value={title} readOnly className="bg-muted/50" />
          </div>
          <div className="space-y-1.5">
            <Label>发布至公众号</Label>
            <Select value={accountId} onValueChange={setAccountId}>
              <SelectTrigger><SelectValue placeholder="选择公众号" /></SelectTrigger>
              <SelectContent>{accounts.filter(a=>a.status==="active").map(a=><SelectItem key={a.id} value={a.id}>{a.name}{a.isDefault ? "（默认）" : ""}</SelectItem>)}</SelectContent>
            </Select>
            {!accounts.length && <p className="text-xs text-amber-600">请先前往设置 → 发布渠道配置 → 微信公众号添加认证。</p>}
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label>摘要（≤120 字）</Label>
              <span className="text-[11px] text-muted-foreground">
                {summary.length}/120
              </span>
            </div>
            <Textarea
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              maxLength={120}
              rows={3}
              placeholder="可在对话中使用 /article-summary 技能生成，或在此手动编辑（留空则由公众号自动截取）"
              className="resize-y"
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>封面图（必填）</Label>
              {cover ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2">
                    <ImageIcon className="h-4 w-4 shrink-0 text-emerald-600" />
                    <span className="text-xs flex-1 text-emerald-700">封面已上传</span>
                    <button
                      onClick={() => setCover(null)}
                      className="text-xs text-red-600 hover:underline shrink-0"
                    >
                      移除
                    </button>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="w-full"
                    onClick={() => setCoverPickerOpen(true)}
                  >
                    <Library className="h-3.5 w-3.5" /> 从素材库更换
                  </Button>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-2">
                  <label className="flex items-center justify-center gap-2 rounded-md border border-dashed border-input px-3 py-3 text-sm text-muted-foreground hover:bg-accent cursor-pointer">
                    {coverUploading ? (
                      <><Loader2 className="h-4 w-4 animate-spin" />上传中…</>
                    ) : (
                      <><ImagePlus className="h-4 w-4" />上传封面（900×383）</>
                    )}
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      disabled={coverUploading}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        e.currentTarget.value = "";
                        if (file) void handleUploadCover(file);
                      }}
                    />
                  </label>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={coverUploading}
                    onClick={() => setCoverPickerOpen(true)}
                  >
                    <Library className="h-3.5 w-3.5" /> 从素材库选择
                  </Button>
                </div>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>排版主题</Label>
              <Select value={themeId} onValueChange={setThemeId}>
                <SelectTrigger>
                  <SelectValue placeholder="选择主题" />
                </SelectTrigger>
                <SelectContent>
                  {themes.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* 发布前公众号效果预览（服务端 juice 全量转换） */}
          <PublishPreview articleId={articleId} themeId={themeId} />

          {error && (
            <div className="rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-700">
              {error}
            </div>
          )}
        </div>
      )}

      {!result && (
        <DialogFooter className="shrink-0 flex-row justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={loading}>
            取消
          </Button>
          <Button onClick={handlePublish} disabled={loading}>
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
            {status === "pushed" ? "更新草稿" : "推送草稿箱"}
          </Button>
        </DialogFooter>
      )}

      <Dialog open={coverPickerOpen} onOpenChange={setCoverPickerOpen}>
        <DialogContent className="max-w-3xl">
          <PickerDialogHeader>
            <PickerDialogTitle>从素材库选择封面</PickerDialogTitle>
            <PickerDialogDescription>
              已有微信 media_id 的图片会直接复用，其他图片将在选中后同步到公众号。
            </PickerDialogDescription>
          </PickerDialogHeader>
          {coverAssetsLoading ? (
            <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> 加载素材库…
            </div>
          ) : coverAssets.length === 0 ? (
            <div className="flex h-48 items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground">
              素材库暂无图片
            </div>
          ) : (
            <div className="grid max-h-[60vh] grid-cols-2 gap-3 overflow-y-auto pr-1 sm:grid-cols-3 md:grid-cols-4">
              {coverAssets.map((asset) => (
                <button
                  key={asset.id}
                  type="button"
                  disabled={selectingAssetId !== null}
                  onClick={() => void handleSelectCoverAsset(asset)}
                  className="group overflow-hidden rounded-md border bg-background text-left hover:border-primary disabled:opacity-60"
                >
                  <div className="relative aspect-[16/9] bg-muted">
                    <img src={asset.url} alt={asset.name} className="h-full w-full object-cover" />
                    {selectingAssetId === asset.id && (
                      <div className="absolute inset-0 flex items-center justify-center bg-background/70">
                        <Loader2 className="h-5 w-5 animate-spin" />
                      </div>
                    )}
                  </div>
                  <div className="truncate px-2 py-1.5 text-xs">{asset.name}</div>
                </button>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
