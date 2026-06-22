"use client";

import { useRef, useState } from "react";
import { Download, Upload, Loader2, Lock, Eye, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { encryptConfig, decryptConfig, isExportPayload } from "@/lib/config-crypto";
import { downloadText } from "@/lib/download";

/** 导出的配置项（来自 /api/system-config/export-raw） */
type RawConfig = { key: string; value: string };

/** 各配置 key 的中文显示名（用于预览展示） */
const KEY_LABELS: Record<string, string> = {
  "inkpress.llm": "AI 模型",
  "inkpress.agent": "写作 Agent",
  "inkpress.oss": "OSS 存储",
  "inkpress.wechat": "微信公众号",
};

/** 配置类型标题前缀 */
const CONFIG_TITLE = "系统配置";

/** 用当天日期生成导出文件名 */
function exportFilename(): string {
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  return `inkpress-config-${ymd}.enc`;
}

/** 把配置数组渲染成脱敏的预览概要（密钥一律不显示） */
function previewConfigs(configs: RawConfig[]): { label: string; summary: string }[] {
  return configs.map((c) => {
    const label = KEY_LABELS[c.key] ?? c.key;
    let parsed: unknown;
    try {
      parsed = JSON.parse(c.value);
    } catch {
      return { label, summary: "（无法解析）" };
    }
    const summary = summarize(c.key, parsed);
    return { label, summary };
  });
}

/** 按 key 提取非敏感概要字段（密钥字段不展示） */
function summarize(key: string, parsed: unknown): string {
  if (Array.isArray(parsed)) {
    // llm 是数组：列出模型名
    const names = parsed
      .map((item) => (item && typeof item === "object" && "name" in item ? String((item as Record<string, unknown>).name) : null))
      .filter(Boolean);
    return names.length ? `${parsed.length} 个：${names.join("、")}` : `${parsed.length} 项`;
  }
  if (parsed && typeof parsed === "object") {
    const obj = parsed as Record<string, unknown>;
    if (key === "inkpress.oss") {
      return `bucket: ${obj.bucket ?? "-"}，domain: ${obj.domain ?? "-"}`;
    }
    if (key === "inkpress.wechat") {
      return `appId: ${obj.appId ?? "-"}`;
    }
    if (key === "inkpress.agent") {
      const projects = Array.isArray(obj.projects) ? obj.projects.length : 0;
      return `maxSteps: ${obj.maxSteps ?? "-"}，projects: ${projects}`;
    }
    return JSON.stringify(Object.keys(obj));
  }
  return String(parsed);
}

export function ConfigImportExport({
  onImported,
}: {
  onImported?: () => void;
}) {
  // 导出相关
  const [exportOpen, setExportOpen] = useState(false);
  const [exportPw, setExportPw] = useState("");
  const [exportPw2, setExportPw2] = useState("");
  const [exportBusy, setExportBusy] = useState(false);
  const [exportErr, setExportErr] = useState<string | null>(null);

  // 导入相关
  const [importStage, setImportStage] = useState<"idle" | "password" | "preview">("idle");
  const [importPw, setImportPw] = useState("");
  const [importErr, setImportErr] = useState<string | null>(null);
  const [importBusy, setImportBusy] = useState(false);
  const [decryptedConfigs, setDecryptedConfigs] = useState<RawConfig[] | null>(null);
  /** 解析失败的原始文件文本（用于错误提示） */
  const pendingPayloadRef = useRef<unknown>(null);
  const importFileInput = useRef<HTMLInputElement>(null);

  function resetExport() {
    setExportPw("");
    setExportPw2("");
    setExportErr(null);
    setExportBusy(false);
  }

  function resetImport() {
    setImportStage("idle");
    setImportPw("");
    setImportErr(null);
    setImportBusy(false);
    setDecryptedConfigs(null);
    pendingPayloadRef.current = null;
    if (importFileInput.current) importFileInput.current.value = "";
  }

  // ---- 导出 ----
  async function doExport() {
    setExportErr(null);
    if (exportPw.length < 6) {
      setExportErr("密码至少 6 位");
      return;
    }
    if (exportPw !== exportPw2) {
      setExportErr("两次输入的密码不一致");
      return;
    }
    setExportBusy(true);
    try {
      const res = await fetch("/api/system-config/export-raw");
      if (!res.ok) throw new Error("读取配置失败");
      const data = (await res.json()) as { configs: RawConfig[] };
      if (!data.configs?.length) {
        setExportErr("当前没有任何可导出的配置");
        setExportBusy(false);
        return;
      }
      const plaintext = JSON.stringify({ exportedAt: new Date().toISOString(), configs: data.configs });
      const payload = await encryptConfig(plaintext, exportPw);
      downloadText(exportFilename(), JSON.stringify(payload, null, 2), "application/octet-stream");
      setExportOpen(false);
      resetExport();
    } catch (e) {
      setExportErr(e instanceof Error ? e.message : "导出失败");
    } finally {
      setExportBusy(false);
    }
  }

  // ---- 导入：选文件 ----
  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportErr(null);
    try {
      const text = await file.text();
      const obj = JSON.parse(text);
      if (!isExportPayload(obj)) {
        setImportErr("不是有效的 InkPress 配置文件（缺少加密字段）");
        if (importFileInput.current) importFileInput.current.value = "";
        return;
      }
      pendingPayloadRef.current = obj;
      setImportStage("password");
    } catch {
      setImportErr("文件解析失败，可能已损坏");
      if (importFileInput.current) importFileInput.current.value = "";
    }
  }

  // ---- 导入：用密码解密 ----
  async function doDecrypt() {
    setImportErr(null);
    const payload = pendingPayloadRef.current;
    if (!payload || !isExportPayload(payload)) {
      setImportErr("配置文件无效");
      return;
    }
    setImportBusy(true);
    try {
      const plaintext = await decryptConfig(payload, importPw);
      const data = JSON.parse(plaintext) as { configs: RawConfig[] };
      if (!data.configs?.length) {
        setImportErr("配置文件为空");
        setImportBusy(false);
        return;
      }
      setDecryptedConfigs(data.configs);
      setImportStage("preview");
    } catch {
      setImportErr("密码错误或文件已损坏");
    } finally {
      setImportBusy(false);
    }
  }

  // ---- 导入：确认覆盖写入 ----
  async function doApplyImport() {
    if (!decryptedConfigs) return;
    setImportBusy(true);
    setImportErr(null);
    try {
      // 逐个 PUT，复用现有 mergeMaskedSecrets 入库逻辑
      // 导入文件含真实密钥（非 ********），会被直接采用
      const results = await Promise.allSettled(
        decryptedConfigs.map((c) =>
          fetch("/api/system-config", {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ key: c.key, value: c.value }),
          })
        )
      );
      const failed = results.filter((r) => r.status === "rejected").length;
      const badStatus = results.filter(
        (r) => r.status === "fulfilled" && !r.value.ok
      ).length;
      if (failed > 0 || badStatus > 0) {
        setImportErr(`${failed + badStatus} 项导入失败，其余已成功`);
      } else {
        resetImport();
        onImported?.();
      }
    } finally {
      setImportBusy(false);
    }
  }

  const previews = decryptedConfigs ? previewConfigs(decryptedConfigs) : [];

  return (
    <div className="flex items-center gap-2">
      {/* 导出按钮 */}
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          resetExport();
          setExportOpen(true);
        }}
      >
        <Download className="h-3.5 w-3.5" />
        导出配置
      </Button>

      {/* 导入按钮 */}
      <Button
        variant="outline"
        size="sm"
        onClick={() => importFileInput.current?.click()}
      >
        <Upload className="h-3.5 w-3.5" />
        导入配置
      </Button>
      <input
        ref={importFileInput}
        type="file"
        accept=".enc,.dat,.json"
        className="hidden"
        onChange={onPickFile}
      />

      {/* 导出弹窗：输入密码 */}
      <Dialog
        open={exportOpen}
        onOpenChange={(v) => {
          if (!v && !exportBusy) {
            setExportOpen(false);
            resetExport();
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Lock className="h-4 w-4" />
              导出配置
            </DialogTitle>
            <DialogDescription>
              输入密码加密导出四大类配置（AI 模型 / 写作 Agent / OSS / 微信公众号）。密码不会保存，忘记密码将无法导入。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs">导出密码（至少 6 位）</Label>
              <Input
                type="password"
                value={exportPw}
                onChange={(e) => setExportPw(e.target.value)}
                placeholder="设置导出密码"
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">确认密码</Label>
              <Input
                type="password"
                value={exportPw2}
                onChange={(e) => setExportPw2(e.target.value)}
                placeholder="再次输入"
              />
            </div>
            {exportErr && (
              <p className="text-xs text-red-600">{exportErr}</p>
            )}
            <div className="rounded-md bg-muted/50 p-2.5 text-[11px] text-muted-foreground leading-relaxed">
              采用 AES-256-GCM + PBKDF2 加密，文件不含密码，泄露后只能暴力破解。请妥善保管导出文件与密码。
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setExportOpen(false);
                resetExport();
              }}
              disabled={exportBusy}
            >
              取消
            </Button>
            <Button onClick={doExport} disabled={exportBusy || !exportPw || !exportPw2}>
              {exportBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              加密导出
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 导入弹窗：输密码 / 预览确认（同一 Dialog，按 stage 切内容） */}
      <Dialog
        open={importStage !== "idle"}
        onOpenChange={(v) => {
          if (!v && !importBusy) resetImport();
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Upload className="h-4 w-4" />
              {importStage === "password" ? "输入导入密码" : "确认导入配置"}
            </DialogTitle>
            <DialogDescription>
              {importStage === "password"
                ? "输入导出时设置的密码，解密后可预览即将导入的配置。"
                : "以下配置将覆盖当前设置（含密钥），确认后逐项写入。"}
            </DialogDescription>
          </DialogHeader>

          {/* 选文件后早期错误（非有效文件） */}
          {importStage === "idle" && importErr && (
            <p className="text-xs text-red-600">{importErr}</p>
          )}

          {/* 密码输入阶段 */}
          {importStage === "password" && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label className="text-xs">导入密码</Label>
                <Input
                  type="password"
                  value={importPw}
                  onChange={(e) => setImportPw(e.target.value)}
                  placeholder="导出时设置的密码"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && importPw && !importBusy) doDecrypt();
                  }}
                />
              </div>
              {importErr && <p className="text-xs text-red-600">{importErr}</p>}
              <div className="rounded-md bg-muted/50 p-2.5 text-[11px] text-muted-foreground">
                密码仅在浏览器内用于解密，不会上传到服务器。
              </div>
            </div>
          )}

          {/* 预览阶段 */}
          {importStage === "preview" && (
            <div className="space-y-2">
              <div className="rounded-md bg-amber-50 border border-amber-200 p-2.5 text-[11px] text-amber-700 flex items-start gap-2">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                <span>导入将覆盖当前同名配置（含密钥），此操作不可撤销。</span>
              </div>
              <div className="space-y-1.5 max-h-64 overflow-y-auto">
                {previews.map((p, i) => (
                  <div key={i} className="rounded-md border border-border p-2">
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary">{p.label}</Badge>
                      <span className="text-[11px] text-muted-foreground truncate">{p.summary}</span>
                    </div>
                  </div>
                ))}
              </div>
              <div className="text-[11px] text-muted-foreground flex items-center gap-1">
                <Eye className="h-3 w-3" />
                密钥已隐藏，导入后按原值写入。
              </div>
              {importErr && <p className="text-xs text-red-600">{importErr}</p>}
            </div>
          )}

          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              variant="outline"
              onClick={() => resetImport()}
              disabled={importBusy}
            >
              取消
            </Button>
            {importStage === "password" && (
              <Button onClick={doDecrypt} disabled={importBusy || !importPw}>
                {importBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />}
                解密预览
              </Button>
            )}
            {importStage === "preview" && (
              <Button
                variant="destructive"
                onClick={doApplyImport}
                disabled={importBusy}
              >
                {importBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                确认覆盖导入
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
