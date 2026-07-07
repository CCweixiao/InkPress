"use client";

import { Fragment } from "react";
import { cn } from "@/lib/utils";
import type { SkillCatalogItem } from "@/lib/ai/skills";

/**
 * 斜杠命令系统（codex 式）：对话框输入 / 列出内置命令 + 已注册 Skill，
 * 命中精确意图路由（/clear 直接清空、/<skill> 强制加载该 Skill）。
 *
 * 设计：注册表是纯数据（token/label/description/group/kind），执行逻辑在
 * WritingAssistant 的 submit 路径按 kind 分发（保留状态就近）—— 与 PART_RENDERERS、
 * INTENT_RULES 同为声明式注册表，加命令/skill 只改数据。Skill 无则整组隐藏。
 */

export type SlashCommandKind = "clear" | "skill";

export type SlashCommand = {
  /** 命令 token，含前导斜杠，如 "/clear"。Skill 用 "/<skillKey>"。 */
  token: string;
  label: string;
  description: string;
  group: "builtin" | "skill";
  kind: SlashCommandKind;
  /** kind === "skill" 时对应的 skillKey。 */
  skillKey?: string;
};

/** 内置命令（静态注册）。/help 由输入 / 即弹出菜单覆盖，不再单列。 */
export const BUILTIN_SLASH_COMMANDS: SlashCommand[] = [
  {
    token: "/clear",
    label: "清空上下文",
    description: "清空对话与提案，并开启新的 Claude 会话（不清 Token 消耗大盘）",
    group: "builtin",
    kind: "clear",
  },
];

/** 把 /api/ai/skills 返回的 Skill 目录映射为斜杠命令（无 Skill 返回空数组）。 */
export function buildSkillCommands(skills: SkillCatalogItem[]): SlashCommand[] {
  return skills
    .filter((skill) => typeof skill.skillKey === "string" && skill.skillKey)
    .map((skill) => ({
      token: `/${skill.skillKey}`,
      label: skill.name || skill.skillKey,
      description: skill.description || "加载该 Skill 执行任务",
      group: "skill" as const,
      kind: "skill" as const,
      skillKey: skill.skillKey,
    }));
}

/** 解析输入首词是否为已知斜杠命令；未知（含不认识的 /xxx）返回 null，按普通消息处理。 */
export function parseSlashCommand(
  input: string,
  commands: SlashCommand[]
): { command: SlashCommand; args: string } | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/")) return null;
  const [first, ...rest] = trimmed.split(/\s+/);
  const args = rest.join(" ");
  const matched = commands.find((cmd) => cmd.token === first);
  return matched ? { command: matched, args } : null;
}

/** 取斜杠菜单是否应打开：输入以 / 开头且尚未输入空格/换行（仍在敲命令 token）。 */
export function slashQuery(input: string): string | null {
  if (!input.startsWith("/")) return null;
  if (/[\s\n]/.test(input)) return null; // token 已结束（/clear 之后打了空格）
  return input; // 形如 "/cl"
}

/** 过滤可见命令：按 token 前缀（去 /）或 label 命中。 */
export function filterSlashCommands(
  commands: SlashCommand[],
  query: string
): SlashCommand[] {
  const q = query.replace(/^\//, "").toLowerCase();
  if (!q) return commands;
  return commands.filter(
    (cmd) =>
      cmd.token.slice(1).toLowerCase().startsWith(q) ||
      cmd.label.toLowerCase().includes(q)
  );
}

function GroupHeader({ group }: { group: SlashCommand["group"] }) {
  return (
    <div className="px-2 pb-1 pt-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
      {group === "builtin" ? "命令" : "Skill"}
    </div>
  );
}

/** 斜杠菜单（展示层）：在对话框上方弹出，分命令/Skill 两组，高亮当前项。 */
export function SlashMenu({
  commands,
  activeIndex,
  onSelect,
}: {
  commands: SlashCommand[];
  activeIndex: number;
  onSelect: (command: SlashCommand) => void;
}) {
  if (!commands.length) return null;
  return (
    <div className="absolute bottom-full left-0 z-20 mb-1 max-h-64 w-72 overflow-y-auto rounded-lg border bg-background p-1 shadow-md">
      {commands.map((cmd, index) => {
        const showHeader =
          index === 0 || commands[index - 1].group !== cmd.group;
        return (
          <Fragment key={cmd.token}>
            {showHeader && <GroupHeader group={cmd.group} />}
            <button
              type="button"
              // onMouseDown 防止 textarea 失焦；点击即选中
              onMouseDown={(event) => {
                event.preventDefault();
                onSelect(cmd);
              }}
              className={cn(
                "flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent",
                index === activeIndex && "bg-accent"
              )}
            >
              <span className="shrink-0 font-mono text-[11px] font-medium text-primary">
                {cmd.token}
              </span>
              <span className="min-w-0">
                <span className="block truncate font-medium text-foreground">
                  {cmd.label}
                </span>
                <span className="block truncate text-[10px] text-muted-foreground">
                  {cmd.description}
                </span>
              </span>
            </button>
          </Fragment>
        );
      })}
      <div className="mt-0.5 border-t px-2 py-1 text-[10px] text-muted-foreground">
        ↑↓ 选择 · Tab/Enter 确认 · Esc 关闭
      </div>
    </div>
  );
}
