/** 客户端共享的技能类型（与 src/lib/skills-manager.ts 的 SkillSummary / SkillDetail 对齐） */

export type SkillSource = "system" | "user";

export type SkillManifest = {
  scripts: string[];
  references: string[];
  agents: string[];
  assets: string[];
  schemas: string[];
  extras: string[];
};

export type SkillSummary = {
  id: string;
  skillKey: string;
  name: string;
  description: string;
  source: SkillSource;
  editable: boolean;
  hasResources: boolean;
  createdAt: string | null;
  updatedAt: string | null;
};

export type SkillDetail = SkillSummary & {
  manual: string;
  promptHint: string | null;
  manifest: string | null;
};
