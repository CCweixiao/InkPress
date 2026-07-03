"use client";

import { useState } from "react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { SystemConfigManager, type ConfigTab } from "./SystemConfigManager";
import { LogsViewer } from "./LogsViewer";
import { UsageDashboard } from "./UsageDashboard";
import { ThemeManager, type ThemeItem } from "@/components/themes/ThemeManager";
import {
  SETTINGS_NAV,
  findNavNode,
  type NavLeaf,
  type NavGroup,
  type SettingsKey,
} from "./settings-nav";

function isConfigTab(key: SettingsKey): key is ConfigTab {
  return (
    key === "llm" ||
    key === "agent" ||
    key === "web" ||
    key === "storage" ||
    key === "wechat"
  );
}

function LeafButton({
  leaf,
  active,
  onClick,
}: {
  leaf: NavLeaf;
  active: boolean;
  onClick: () => void;
}) {
  const Icon = leaf.icon;
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-left text-sm transition-colors",
        active
          ? "bg-accent text-accent-foreground font-medium"
          : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
      )}
    >
      <Icon className="h-4 w-4 shrink-0" />
      <span className="truncate">{leaf.label}</span>
    </button>
  );
}

function GroupNav({
  group,
  activeKey,
  onSelect,
}: {
  group: NavGroup;
  activeKey: SettingsKey;
  onSelect: (key: SettingsKey) => void;
}) {
  const Icon = group.icon;
  const childActive = group.children.some((c) => c.key === activeKey);
  return (
    <Collapsible defaultOpen={group.defaultOpen ?? true}>
      <CollapsibleTrigger
        className={cn(
          "px-2.5 py-1.5 rounded-md text-sm transition-colors",
          childActive
            ? "text-foreground font-medium"
            : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
        )}
      >
        <Icon className="h-4 w-4 shrink-0" />
        <span className="truncate">{group.label}</span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="ml-4 border-l border-border pl-2 space-y-1 mt-1">
          {group.children.map((child) => (
            <LeafButton
              key={child.key}
              leaf={child}
              active={activeKey === child.key}
              onClick={() => onSelect(child.key)}
            />
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

export function SettingsShell({ themes }: { themes: ThemeItem[] }) {
  const [activeKey, setActiveKey] = useState<SettingsKey>("agent");
  const currentNode = findNavNode(activeKey);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[220px_1fr] gap-6">
      {/* 左侧树状导航 */}
      <nav className="space-y-1">
        {SETTINGS_NAV.map((node) => {
          if (node.kind === "leaf") {
            return (
              <LeafButton
                key={node.key}
                leaf={node}
                active={activeKey === node.key}
                onClick={() => setActiveKey(node.key)}
              />
            );
          }
          return (
            <GroupNav
              key={node.key}
              group={node}
              activeKey={activeKey}
              onSelect={setActiveKey}
            />
          );
        })}
      </nav>

      {/* 右侧内容 */}
      <div className="min-w-0 space-y-4">
        {/* 标题区：替代原 Card 的 CardHeader，提升视觉层级 */}
        {currentNode && (
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <currentNode.icon className="h-5 w-5 text-primary" />
              <h2 className="text-lg font-semibold">{currentNode.label}</h2>
            </div>
            <p className="text-sm text-muted-foreground">
              {currentNode.description}
            </p>
          </div>
        )}

        {/* 始终挂载：通过 hidden 切换，避免切换 Tab 时表单状态丢失 / SSE 重连 */}
        <div className={activeKey === "logs" ? "block" : "hidden"}>
          <LogsViewer />
        </div>
        <div className={activeKey === "usage" ? "block" : "hidden"}>
          <UsageDashboard />
        </div>
        <div className={activeKey === "theme" ? "block" : "hidden"}>
          <ThemeManager themes={themes} />
        </div>
        <div className={isConfigTab(activeKey) ? "block" : "hidden"}>
          <SystemConfigManager activeTab={isConfigTab(activeKey) ? activeKey : "agent"} />
        </div>
      </div>
    </div>
  );
}
