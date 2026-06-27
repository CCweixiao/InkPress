"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import MarkdownIt from "markdown-it";
import {
  AlertTriangle,
  FileJson,
  FileText,
  Loader2,
  Network,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export type CodeGraphDetail = {
  id: string;
  provider: string;
  status: string;
  projectName: string;
  root: string;
  snapshotHash: string;
  nodeCount: number;
  edgeCount: number;
  lastError: string | null;
  hasReport: boolean;
  hasHtml: boolean;
  hasGraph: boolean;
  updatedAt: string;
  metadata: Record<string, unknown>;
};

type Tab = "overview" | "report" | "graph";

const md = new MarkdownIt({ html: false, linkify: true, breaks: false });

export function CodeGraphViewer({ graph }: { graph: CodeGraphDetail }) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("overview");
  const [report, setReport] = useState<string | null>(null);
  const [reportError, setReportError] = useState<string | null>(null);
  const [graphJson, setGraphJson] = useState<string | null>(null);
  const [graphError, setGraphError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (tab !== "report" || report !== null || reportError) return;
    setReport(null);
    setReportError(null);
    fetch(`/api/code-graphs/${graph.id}/report`)
      .then((res) => (res.ok ? res.text() : Promise.reject(new Error("报告不可用"))))
      .then((text) => setReport(text))
      .catch((err: Error) => setReportError(err.message));
  }, [tab, graph.id, report, reportError]);

  useEffect(() => {
    if (tab !== "graph" || graphJson !== null || graphError) return;
    setGraphJson(null);
    setGraphError(null);
    fetch(`/api/code-graphs/${graph.id}/graph`)
      .then((res) => (res.ok ? res.text() : Promise.reject(new Error("图谱不可用"))))
      .then((text) => setGraphJson(text))
      .catch((err: Error) => setGraphError(err.message));
  }, [tab, graph.id, graphJson, graphError]);

  const reportHtml = useMemo(
    () => (report ? md.render(report) : ""),
    [report]
  );

  async function deleteGraph() {
    if (!confirm("确认删除这份代码图谱？关联的报告、HTML 和原始图文件会一并清理。")) return;
    setDeleting(true);
    const res = await fetch(`/api/code-graphs/${graph.id}`, { method: "DELETE" });
    setDeleting(false);
    if (res.ok) router.push("/code-graphs");
  }

  const ready = graph.status === "ready";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b bg-card px-4 py-3">
        <div className="flex items-center gap-2">
          <Network className="h-4 w-4 text-primary" />
          <span className="text-sm font-medium">{graph.projectName || "代码图谱"}</span>
        </div>
        <Badge variant="secondary">{graph.provider}</Badge>
        <Badge
          variant={ready ? "success" : graph.status === "failed" ? "outline" : "warning"}
          className={graph.status === "failed" ? "border-transparent bg-red-100 text-red-700" : ""}
        >
          {graph.status}
        </Badge>
        {ready && (
          <span className="text-xs text-muted-foreground">
            {graph.nodeCount} 符号 · {graph.edgeCount} 边
          </span>
        )}
        <span className="text-xs text-muted-foreground">
          快照 <code>{graph.snapshotHash.slice(0, 8)}</code>
        </span>
        <span className="ml-auto" />
        <Button
          variant="outline"
          size="sm"
          disabled={deleting}
          onClick={deleteGraph}
          className="text-red-600 hover:text-red-700"
        >
          {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
          删除
        </Button>
      </div>

      {graph.status === "failed" && graph.lastError && (
        <div className="flex items-start gap-2 border-b bg-red-50 px-4 py-2 text-xs text-red-700">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <pre className="whitespace-pre-wrap break-all font-sans">{graph.lastError}</pre>
        </div>
      )}

      <div className="flex gap-1 border-b bg-card px-4">
        <TabButton active={tab === "overview"} onClick={() => setTab("overview")} icon={<Network className="h-3.5 w-3.5" />}>
          概览
        </TabButton>
        <TabButton active={tab === "report"} onClick={() => setTab("report")} icon={<FileText className="h-3.5 w-3.5" />} disabled={!graph.hasReport}>
          报告
        </TabButton>
        <TabButton active={tab === "graph"} onClick={() => setTab("graph")} icon={<FileJson className="h-3.5 w-3.5" />} disabled={!graph.hasGraph}>
          原始图
        </TabButton>
      </div>

      <div className="min-h-0 flex-1 overflow-auto bg-muted/20">
        {tab === "overview" && (
          graph.hasHtml ? (
            <iframe
              key={graph.id}
              src={`/api/code-graphs/${graph.id}/html`}
              title="代码图谱可视化"
              className="h-full min-h-[600px] w-full border-0 bg-white"
            />
          ) : (
            <EmptyState text="这份图谱没有 HTML 可视化（可能由 Graphify CLI 生成且未产出 graph.html）。" />
          )
        )}

        {tab === "report" && (
          reportError ? (
            <EmptyState text={reportError} />
          ) : report === null ? (
            <LoadingState />
          ) : (
            <div
              className="technical-markdown prose prose-slate mx-auto max-w-4xl px-6 py-6 text-sm leading-7"
              dangerouslySetInnerHTML={{ __html: reportHtml }}
            />
          )
        )}

        {tab === "graph" && (
          graphError ? (
            <EmptyState text={graphError} />
          ) : graphJson === null ? (
            <LoadingState />
          ) : (
            <JsonTree raw={graphJson} />
          )
        )}
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  children,
  disabled,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-xs font-medium transition-colors ${
        active
          ? "border-primary text-primary"
          : "border-transparent text-muted-foreground hover:text-foreground"
      } ${disabled ? "cursor-not-allowed opacity-40" : ""}`}
    >
      {icon}
      {children}
    </button>
  );
}

function LoadingState() {
  return (
    <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" />
      加载中…
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="py-16 text-center text-sm text-muted-foreground">{text}</div>
  );
}

function JsonTree({ raw }: { raw: string }) {
  const [collapsed, setCollapsed] = useState(true);
  let parsed: unknown = raw;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = raw;
  }
  const pretty = useMemo(
    () => (typeof parsed === "string" ? parsed : JSON.stringify(parsed, null, 2)),
    [parsed]
  );
  const sizeKb = Math.max(1, Math.round(new Blob([pretty]).size / 1024));
  return (
    <div className="mx-auto max-w-4xl px-6 py-4">
      <div className="mb-3 flex items-center gap-2 text-xs text-muted-foreground">
        <span>{sizeKb} KB</span>
        <Button variant="outline" size="sm" onClick={() => setCollapsed((v) => !v)}>
          {collapsed ? "展开 JSON" : "折叠"}
        </Button>
      </div>
      {collapsed ? (
        <pre className="max-h-64 overflow-auto rounded-lg border bg-card p-3 text-xs">
          {pretty.slice(0, 2000)}
          {pretty.length > 2000 ? `\n…（已截断，共 ${pretty.length} 字符）` : ""}
        </pre>
      ) : (
        <pre className="max-h-[70vh] overflow-auto rounded-lg border bg-card p-3 text-xs">
          {pretty}
        </pre>
      )}
    </div>
  );
}
