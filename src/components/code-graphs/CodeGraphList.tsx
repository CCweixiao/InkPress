"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Loader2, Network, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";

export type CodeGraphListItem = {
  id: string;
  provider: string;
  status: string;
  projectName: string;
  root: string;
  snapshotHash: string;
  nodeCount: number;
  edgeCount: number;
  updatedAt: string;
};

type ProjectItem = { id: string; name: string };

const STATUS_LABELS: Record<string, { label: string; variant: "default" | "success" | "warning" | "outline" }> = {
  ready: { label: "就绪", variant: "success" },
  building: { label: "构建中", variant: "warning" },
  pending: { label: "等待", variant: "warning" },
  failed: { label: "失败", variant: "outline" },
  stale: { label: "过期", variant: "outline" },
};

function statusBadge(status: string) {
  const meta = STATUS_LABELS[status] ?? { label: status, variant: "outline" as const };
  return (
    <Badge
      variant={meta.variant}
      className={status === "failed" ? "border-transparent bg-red-100 text-red-700" : ""}
    >
      {meta.label}
    </Badge>
  );
}

export function CodeGraphList({ initialGraphs }: { initialGraphs: CodeGraphListItem[] }) {
  const router = useRouter();
  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [projectId, setProjectId] = useState("");
  const [provider, setProvider] = useState<"native" | "graphify">("native");
  const [refresh, setRefresh] = useState(false);
  const [building, setBuilding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/ai/projects")
      .then((response) => response.json())
      .then((data) => {
        setProjects(data.projects ?? []);
        setProjectId((current) => current || data.projects?.[0]?.id || "");
      })
      .catch(() => {});
  }, []);

  async function buildGraph() {
    if (!projectId) return;
    setBuilding(true);
    setError(null);
    try {
      const response = await fetch("/api/code-graphs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId, provider, refresh }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data?.error ?? "构建失败");
        setBuilding(false);
        return;
      }
      if (data.graph?.id) {
        router.push(`/code-graphs/${data.graph.id}`);
      } else {
        setError("构建完成但未返回图谱记录。");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "构建请求异常");
    } finally {
      setBuilding(false);
    }
  }

  return (
    <div className="space-y-7">
      <div className="rounded-xl border bg-card p-4">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
          <Network className="h-4 w-4 text-primary" />
          构建代码图谱
        </div>
        <div className="grid gap-3 md:grid-cols-[1.4fr_1fr_1fr_auto]">
          <Select value={projectId} onValueChange={setProjectId}>
            <SelectTrigger>
              <SelectValue placeholder="选择长期信任项目" />
            </SelectTrigger>
            <SelectContent>
              {projects.map((project) => (
                <SelectItem key={project.id} value={project.id}>
                  {project.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={provider} onValueChange={(value) => setProvider(value as "native" | "graphify")}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="native">原生（零依赖）</SelectItem>
              <SelectItem value="graphify">Graphify CLI</SelectItem>
            </SelectContent>
          </Select>
          <label className="flex cursor-pointer items-center gap-2 rounded-md border px-3 text-sm">
            <input
              type="checkbox"
              checked={refresh}
              onChange={(event) => setRefresh(event.target.checked)}
              className="h-4 w-4 accent-primary"
            />
            <RefreshCw className="h-3.5 w-3.5 text-muted-foreground" />
            强制刷新
          </label>
          <Button disabled={!projectId || building} onClick={buildGraph}>
            {building ? <Loader2 className="h-4 w-4 animate-spin" /> : <Network className="h-4 w-4" />}
            构建
          </Button>
        </div>
        {!projects.length && (
          <p className="mt-3 text-xs text-amber-700">
            请先在设置页添加长期信任项目，才能构建代码图谱。
          </p>
        )}
        {provider === "graphify" && (
          <p className="mt-3 text-xs text-muted-foreground">
            Graphify CLI 需要先安装 Python 包：<code>uv tool install graphifyy</code>。未安装时会自动降级失败。
          </p>
        )}
        {error && (
          <p className="mt-3 text-xs text-red-600">{error}</p>
        )}
      </div>

      {initialGraphs.length === 0 ? (
        <div className="rounded-xl border border-dashed bg-card p-10 text-center text-sm text-muted-foreground">
          还没有代码图谱。选择一个项目并点击「构建」生成第一份图谱。
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {initialGraphs.map((graph) => (
            <Link
              key={graph.id}
              href={`/code-graphs/${graph.id}`}
              className="rounded-xl border bg-card p-4 transition hover:border-primary/40 hover:shadow-sm"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h2 className="truncate font-medium">
                    {graph.projectName || graph.root || "未命名项目"}
                  </h2>
                  <p className="mt-1 truncate text-xs text-muted-foreground">
                    {graph.root || "—"}
                  </p>
                </div>
                {statusBadge(graph.status)}
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Badge variant="secondary">{graph.provider}</Badge>
                {graph.status === "ready" && (
                  <span className="text-[11px] text-muted-foreground">
                    {graph.nodeCount} 符号 · {graph.edgeCount} 边
                  </span>
                )}
              </div>
              <p className="mt-3 text-[11px] text-muted-foreground">
                更新于 {new Date(graph.updatedAt).toLocaleString("zh-CN")}
              </p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
