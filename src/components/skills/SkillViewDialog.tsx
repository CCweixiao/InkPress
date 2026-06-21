"use client";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import type { SkillDetail, SkillManifest } from "@/types/skill";

const RESOURCE_GROUP_LABELS: { key: keyof SkillManifest; label: string }[] = [
  { key: "scripts", label: "脚本 scripts/" },
  { key: "references", label: "参考 references/" },
  { key: "agents", label: "智能体 agents/" },
  { key: "assets", label: "资源 assets/" },
  { key: "schemas", label: "Schema schemas/" },
  { key: "extras", label: "其他" },
];

function parseManifest(raw: string | null): SkillManifest | null {
  if (!raw) return null;
  try {
    const obj = JSON.parse(raw) as Partial<SkillManifest>;
    return {
      scripts: obj.scripts ?? [],
      references: obj.references ?? [],
      agents: obj.agents ?? [],
      assets: obj.assets ?? [],
      schemas: obj.schemas ?? [],
      extras: obj.extras ?? [],
    };
  } catch {
    return null;
  }
}

/** 只读查看完整 SKILL.md（系统与用户均可）。含资源时展示资源清单。 */
export function SkillViewDialog({
  skill,
  open,
  onOpenChange,
}: {
  skill: SkillDetail | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  if (!skill) return null;
  const manifest = parseManifest(skill.manifest);
  const manifestGroups = manifest
    ? RESOURCE_GROUP_LABELS.filter((g) => (manifest[g.key]?.length ?? 0) > 0)
    : [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="truncate">{skill.name}</span>
            <Badge variant={skill.source === "user" ? "default" : "secondary"}>
              {skill.source === "user" ? "用户" : "系统"}
            </Badge>
          </DialogTitle>
          <DialogDescription>{skill.description || "（无描述）"}</DialogDescription>
        </DialogHeader>

        <div className="text-xs text-muted-foreground border-y border-border py-1.5">
          目录：<code className="font-mono">resources/skills/{skill.skillKey}/</code>
        </div>

        {manifestGroups.length > 0 && (
          <div className="space-y-2">
            <div className="text-xs font-semibold text-muted-foreground">资源文件</div>
            <div className="space-y-1.5">
              {manifestGroups.map((g) => (
                <div key={g.key} className="text-xs">
                  <span className="text-muted-foreground">{g.label}</span>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {manifest![g.key].map((f) => (
                      <Badge key={f} variant="outline" className="font-mono text-[10px]">
                        {f}
                      </Badge>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <pre className="flex-1 overflow-auto whitespace-pre-wrap rounded-md bg-muted/40 p-3 text-xs leading-relaxed font-mono">
          {`---\nname: ${skill.name}\ndescription: ${skill.description}\n---\n${skill.manual}`}
        </pre>
      </DialogContent>
    </Dialog>
  );
}
