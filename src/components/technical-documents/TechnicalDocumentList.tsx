"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { FileCode2, Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";

type DocumentItem = {
  id: string;
  title: string;
  documentType: string;
  projectId: string;
  snapshotHash: string;
  updatedAt: string;
};

type ProjectItem = { id: string; name: string };

const TYPE_LABELS: Record<string, string> = {
  architecture: "架构概览",
  implementation: "功能实现",
  "call-chain": "调用链分析",
  "module-reference": "模块参考",
  dependency: "依赖关系",
};

export function TechnicalDocumentList({
  initialDocuments,
}: {
  initialDocuments: DocumentItem[];
}) {
  const router = useRouter();
  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [title, setTitle] = useState("");
  const [projectId, setProjectId] = useState("");
  const [documentType, setDocumentType] = useState("architecture");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    fetch("/api/ai/projects")
      .then((response) => response.json())
      .then((data) => {
        setProjects(data.projects ?? []);
        setProjectId((current) => current || data.projects?.[0]?.id || "");
      })
      .catch(() => {});
  }, []);

  async function createDocument() {
    if (!projectId) return;
    setCreating(true);
    const response = await fetch("/api/technical-documents", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: title.trim() || "未命名技术文档",
        projectId,
        documentType,
      }),
    });
    const data = await response.json().catch(() => ({}));
    setCreating(false);
    if (response.ok) router.push(`/technical-documents/${data.document.id}`);
  }

  return (
    <div className="space-y-7">
      <div className="rounded-xl border bg-card p-4">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
          <Plus className="h-4 w-4 text-primary" />
          新建技术文档
        </div>
        <div className="grid gap-3 md:grid-cols-[1.4fr_1fr_1fr_auto]">
          <Input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="文档标题"
          />
          <Select value={projectId} onValueChange={setProjectId}>
            <SelectTrigger>
              <SelectValue placeholder="选择白名单项目" />
            </SelectTrigger>
            <SelectContent>
              {projects.map((project) => (
                <SelectItem key={project.id} value={project.id}>
                  {project.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={documentType} onValueChange={setDocumentType}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(TYPE_LABELS).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button disabled={!projectId || creating} onClick={createDocument}>
            {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            创建
          </Button>
        </div>
        {!projects.length && (
          <p className="mt-3 text-xs text-amber-700">
            请先在设置页添加本地项目白名单。
          </p>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {initialDocuments.map((document) => (
          <Link
            key={document.id}
            href={`/technical-documents/${document.id}`}
            className="rounded-xl border bg-card p-4 transition hover:border-primary/40 hover:shadow-sm"
          >
            <div className="flex items-start gap-3">
              <div className="rounded-lg bg-primary/10 p-2 text-primary">
                <FileCode2 className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <h2 className="truncate font-medium">
                  {document.title || "未命名技术文档"}
                </h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  {TYPE_LABELS[document.documentType] ?? document.documentType} ·{" "}
                  {document.projectId}
                </p>
                <p className="mt-3 text-[11px] text-muted-foreground">
                  更新于 {new Date(document.updatedAt).toLocaleString("zh-CN")}
                </p>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
