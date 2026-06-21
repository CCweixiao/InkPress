"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { SkillSummary } from "@/types/skill";

/**
 * 新建 / 编辑用户技能。
 * - skill === null：新建模式，提交 POST /api/skills
 * - skill 不为空：编辑模式，提交 PATCH /api/skills/[id]
 * initial（AI 生成草稿）可不传：新建时用于预填 name/description/manual。
 */
export function SkillEditDialog({
  skill,
  initial,
  open,
  onOpenChange,
  onSaved,
}: {
  skill: SkillSummary | null;
  initial?: { name?: string; description?: string; manual?: string; promptHint?: string | null } | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSaved?: () => void;
}) {
  const isEdit = skill !== null;
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [manual, setManual] = useState("");
  const [promptHint] = useState<string | null>(initial?.promptHint ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    if (isEdit && skill) {
      // 编辑时：name/description 来自 skill，manual 来自 initial（父组件从详情接口预取）
      setName(skill.name);
      setDescription(skill.description);
      setManual(initial?.manual ?? "");
    } else {
      setName(initial?.name ?? "");
      setDescription(initial?.description ?? "");
      setManual(initial?.manual ?? "");
    }
    setError("");
  }, [open, isEdit, skill, initial]);

  async function save() {
    setError("");
    if (!name.trim()) {
      setError("请填写技能名称");
      return;
    }
    setLoading(true);
    try {
      const url = isEdit ? `/api/skills/${skill!.id}` : "/api/skills";
      const method = isEdit ? "PATCH" : "POST";
      const body: Record<string, unknown> = { name, description, manual };
      if (!isEdit && promptHint) body.promptHint = promptHint;
      const res = await fetch(url, {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error?.formErrors?.[0] || data.error || "保存失败");
        return;
      }
      onOpenChange(false);
      onSaved?.();
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-hidden flex flex-col skill-form">
        <DialogHeader>
          <DialogTitle>{isEdit ? "编辑技能" : "新建技能"}</DialogTitle>
          <DialogDescription>
            技能保存后会写入 resources/skills 目录，写作助手将自动识别并按需应用。
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-auto space-y-5 pr-1 skill-form">
          <div className="space-y-2">
            <Label htmlFor="skill-name" className="text-[13px] font-medium">
              名称 <span className="text-destructive">*</span>
            </Label>
            <Input
              id="skill-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="如：电商带货软文"
              className="h-10"
            />
            <p className="text-xs text-muted-foreground">
              作为技能标识，自动生成目录名（小写连字符）。
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="skill-desc" className="text-[13px] font-medium">
              描述（触发依据） <span className="text-destructive">*</span>
            </Label>
            <Input
              id="skill-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="一句话说明用途和适用场景"
              className="h-10"
            />
            <p className="text-xs text-muted-foreground">
              写作助手依据此描述判断在何时应用该技能，请写清触发场景。
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="skill-manual" className="text-[13px] font-medium">
              指令正文（Markdown）
            </Label>
            <Textarea
              id="skill-manual"
              value={manual}
              onChange={(e) => setManual(e.target.value)}
              rows={14}
              className="font-mono text-xs leading-relaxed"
              placeholder={"# 技能标题\n\n用祈使句写操作流程…"}
            />
            <p className="text-xs text-muted-foreground">
              用祈使句写操作流程、判断标准与输出格式，避免空泛口号。
            </p>
          </div>
        </div>

        {error && (
          <p className="text-sm text-destructive bg-destructive/5 border border-destructive/20 rounded-md px-3 py-2">
            {error}
          </p>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={loading}>
            取消
          </Button>
          <Button onClick={save} disabled={loading}>
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {isEdit ? "保存" : "创建"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
