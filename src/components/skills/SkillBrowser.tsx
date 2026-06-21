"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import {
  Plus,
  Wand2,
  Eye,
  Pencil,
  Trash2,
  Loader2,
  Boxes,
  User,
  Shield,
  Upload,
  Package,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { SkillViewDialog } from "@/components/skills/SkillViewDialog";
import { SkillEditDialog } from "@/components/skills/SkillEditDialog";
import { SkillGenerateDialog } from "@/components/skills/SkillGenerateDialog";
import type { SkillSummary, SkillDetail } from "@/types/skill";

type Filter = "all" | "user" | "system";

export function SkillBrowser() {
  const [skills, setSkills] = useState<SkillSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>("all");
  const [, startTransition] = useTransition();
  const { confirm, dialog } = useConfirm();

  // 弹窗状态
  const [viewing, setViewing] = useState<SkillDetail | null>(null);
  const [viewOpen, setViewOpen] = useState(false);
  const [editing, setEditing] = useState<SkillSummary | null>(null);
  const [editInitial, setEditInitial] = useState<{
    name?: string;
    description?: string;
    manual?: string;
    promptHint?: string | null;
  } | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [genOpen, setGenOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const zipInput = useRef<HTMLInputElement | null>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/skills");
      const data = await res.json();
      setSkills(data.skills ?? []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function viewSkill(skill: SkillSummary) {
    const res = await fetch(`/api/skills/${skill.id}`);
    const data = await res.json();
    if (res.ok) {
      setViewing(data.skill as SkillDetail);
      setViewOpen(true);
    }
  }

  function newSkill() {
    setEditing(null);
    setEditInitial(null);
    setEditOpen(true);
  }

  async function editSkill(skill: SkillSummary) {
    // 编辑需要 manual，从详情接口取
    const res = await fetch(`/api/skills/${skill.id}`);
    const data = await res.json();
    if (res.ok) {
      const detail = data.skill as SkillDetail;
      setEditing({
        ...skill,
        // 让 SkillEditDialog 的 useEffect 能拿到 manual
        ...(skill as SkillSummary & { manual?: string }),
      } as SkillSummary);
      setEditInitial({
        name: detail.name,
        description: detail.description,
        manual: detail.manual,
        promptHint: detail.promptHint,
      });
      setEditOpen(true);
    }
  }

  async function remove(skill: SkillSummary) {
    const ok = await confirm({
      title: "删除技能",
      description: `确认删除「${skill.name}」？该技能将从资源目录和写作助手中移除，不可恢复。`,
      variant: "destructive",
    });
    if (!ok) return;
    startTransition(async () => {
      const res = await fetch(`/api/skills/${skill.id}`, { method: "DELETE" });
      if (res.ok) setSkills((cur) => cur.filter((s) => s.id !== skill.id));
    });
  }

  /** AI 生成草稿 → 交给 SkillEditDialog 保存 */
  function onGenerated(draft: {
    name: string;
    description: string;
    manual: string;
    promptHint: string;
  }) {
    setEditing(null);
    setEditInitial(draft);
    setEditOpen(true);
  }

  /** 上传 skill 压缩包（.zip）→ 自动解压校验 → 落库后刷新列表 */
  async function uploadZip(files: FileList) {
    const file = files[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".zip")) {
      window.alert("仅支持 .zip 压缩包");
      if (zipInput.current) zipInput.current.value = "";
      return;
    }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/skills/upload", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) {
        window.alert(data.error || "上传失败：压缩包校验未通过");
        return;
      }
      await load();
    } catch {
      window.alert("上传失败，请重试");
    } finally {
      setUploading(false);
      if (zipInput.current) zipInput.current.value = "";
    }
  }

  const filtered = skills.filter((s) =>
    filter === "all" ? true : filter === "user" ? s.source === "user" : s.source === "system"
  );

  return (
    <div className="space-y-4">
      {/* 顶部操作栏 */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-1 rounded-md border border-border p-1">
          {(
            [
              { key: "all", label: "全部", count: skills.length },
              { key: "user", label: "用户", count: skills.filter((s) => s.source === "user").length },
              { key: "system", label: "系统", count: skills.filter((s) => s.source === "system").length },
            ] as { key: Filter; label: string; count: number }[]
          ).map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={cn(
                "px-3 py-1 rounded text-sm transition-colors",
                filter === f.key
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {f.label}
              <span className="ml-1 text-xs opacity-70">{f.count}</span>
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={newSkill}>
            <Plus className="mr-1.5 h-4 w-4" />
            新建技能
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => zipInput.current?.click()}
            disabled={uploading}
          >
            {uploading ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <Upload className="mr-1.5 h-4 w-4" />
            )}
            上传压缩包
          </Button>
          <Button size="sm" onClick={() => setGenOpen(true)}>
            <Wand2 className="mr-1.5 h-4 w-4" />
            AI 生成
          </Button>
        </div>
      </div>

      {/* 隐藏的 zip 文件选择器 */}
      <input
        ref={zipInput}
        type="file"
        accept=".zip"
        className="hidden"
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) {
            void uploadZip(e.target.files);
          }
        }}
      />

      {/* 列表 */}
      {loading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" />
          加载中…
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-2">
          <Boxes className="h-10 w-10 opacity-40" />
          <p className="text-sm">暂无技能</p>
          <p className="text-xs">点击「新建技能」或「AI 生成」添加你的第一个写作技能</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map((skill) => (
            <Card key={skill.id} className="p-4 flex flex-col gap-2">
              <div className="flex items-start justify-between gap-2">
                <h3 className="font-medium leading-tight line-clamp-1">{skill.name}</h3>
                <Badge
                  variant={skill.source === "user" ? "default" : "secondary"}
                  className="shrink-0"
                >
                  {skill.source === "user" ? (
                    <>
                      <User className="h-3 w-3 mr-1" />
                      用户
                    </>
                  ) : (
                    <>
                      <Shield className="h-3 w-3 mr-1" />
                      系统
                    </>
                  )}
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground line-clamp-3 min-h-[3.75rem]">
                {skill.description || "（无描述）"}
              </p>
              <div className="text-xs text-muted-foreground border-t border-border pt-2 mt-auto flex items-center gap-2">
                <code className="font-mono truncate">{skill.skillKey}</code>
                {skill.hasResources && (
                  <Badge variant="outline" className="shrink-0 gap-1 px-1.5 text-[10px]">
                    <Package className="h-3 w-3" />
                    含资源
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-1 pt-1">
                <Button variant="ghost" size="sm" onClick={() => viewSkill(skill)} className="h-8">
                  <Eye className="mr-1 h-3.5 w-3.5" />
                  查看
                </Button>
                {skill.editable && (
                  <>
                    <Button variant="ghost" size="sm" onClick={() => editSkill(skill)} className="h-8">
                      <Pencil className="mr-1 h-3.5 w-3.5" />
                      编辑
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => remove(skill)}
                      className="h-8 text-destructive hover:text-destructive"
                    >
                      <Trash2 className="mr-1 h-3.5 w-3.5" />
                      删除
                    </Button>
                  </>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* 弹窗 */}
      <SkillViewDialog skill={viewing} open={viewOpen} onOpenChange={setViewOpen} />
      <SkillEditDialog
        skill={editing}
        initial={editInitial}
        open={editOpen}
        onOpenChange={setEditOpen}
        onSaved={() => load()}
      />
      <SkillGenerateDialog
        open={genOpen}
        onOpenChange={setGenOpen}
        onGenerated={onGenerated}
      />
      {dialog}
    </div>
  );
}
