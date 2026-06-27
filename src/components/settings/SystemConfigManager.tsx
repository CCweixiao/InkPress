"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import {
  Save,
  Trash2,
  Loader2,
  Plus,
  CheckCircle2,
  Sparkles,
  Cloud,
  Bot,
  FolderCode,
  MessageCircle,
  GripVertical,
  ChevronDown,
  ExternalLink,
} from "lucide-react";
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  closestCorners,
  type DragEndEvent,
} from "@dnd-kit/core";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { LLM_PRESETS } from "@/lib/llm-presets";
import { ConfigImportExport } from "./ConfigImportExport";

export const LLM_CONFIG_KEY = "inkpress.llm";
export const OSS_CONFIG_KEY = "inkpress.oss";
export const STORAGE_CONFIG_KEY = "inkpress.storage";
export const AGENT_CONFIG_KEY = "inkpress.agent";
export const WECHAT_CONFIG_KEY = "inkpress.wechat";

type Tab = "llm" | "agent" | "storage" | "wechat";

type SystemConfig = {
  id: string;
  key: string;
  value: string;
  createdAt: string;
  updatedAt: string;
};

type StorageInfo = {
  localPath: string;
};

type LlmFormModel = {
  id: string;
  name: string;
  enabled: boolean;
  isDefault: boolean;
};

type LlmForm = {
  id: string;
  name: string;
  apiProvider: string;
  baseUrl: string;
  apiKey: string;
  models: LlmFormModel[];
  temperature: number;
};

type OssForm = {
  bucket: string;
  domain: string;
  accessKeyId: string;
  accessKeySecret: string;
};

type StorageForm = {
  defaultProvider: "local" | "aliyun-oss";
  providers: {
    local: { enabled: true };
    aliyunOss: OssForm & { enabled: boolean };
  };
};

type AgentProjectForm = {
  id: string;
  name: string;
  root: string;
};

type AgentForm = {
  tavilyApiKey: string;
  githubToken: string;
  projects: AgentProjectForm[];
  maxSteps: number;
  contextBudgetTokens: number;
};

type WechatForm = {
  appId: string;
  secret: string;
};

/** 自定义新增供应商的空模板（models 空、各连接字段空）。 */
const EMPTY_LLM_PROVIDER: LlmForm = {
  id: "",
  name: "",
  apiProvider: "openai-compatible",
  baseUrl: "",
  apiKey: "",
  models: [],
  temperature: 0.7,
};

const EMPTY_OSS: OssForm = {
  bucket: "",
  domain: "",
  accessKeyId: "",
  accessKeySecret: "",
};

const EMPTY_STORAGE: StorageForm = {
  defaultProvider: "local",
  providers: {
    local: { enabled: true },
    aliyunOss: {
      enabled: false,
      ...EMPTY_OSS,
    },
  },
};

const EMPTY_WECHAT: WechatForm = {
  appId: "",
  secret: "",
};

const DEFAULT_AGENT: AgentForm = {
  tavilyApiKey: "",
  githubToken: "",
  projects: [],
  maxSteps: 12,
  contextBudgetTokens: 32000,
};

/**
 * 解析 inkpress.llm 的原始 JSON 字符串为表单状态。
 * - 新形状：models 为对象数组，每项含 enabled/isDefault。
 * - 旧形状（向后兼容）：供应商级 enabled/isDefault + models 为字符串数组 →
 *   字符串模型继承 legacyEnabled；legacyDefault 时首个模型置为 default。
 * - 空值返回 []，让 7 个预设以「未配置」形态出现在树里。
 */
function parseLlmValue(value?: string): LlmForm[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    const items = Array.isArray(parsed) ? parsed : [parsed];
    const configs = items
      .filter((item) => item && typeof item === "object")
      .map((item, index) => {
        const c = item as Record<string, unknown> & {
          apiUrl?: string;
          api?: string;
          key?: string;
          provider?: string;
        };
        const legacyEnabled =
          typeof c.enabled === "boolean" ? c.enabled : true;
        const legacyDefault = Boolean(c.default ?? c.isDefault);
        const rawModels = (c.models ?? c.model) as unknown;
        const models: LlmFormModel[] = Array.isArray(rawModels)
          ? (rawModels
              .map((m, i) => {
                if (typeof m === "string") {
                  return {
                    id: m,
                    name: m,
                    enabled: legacyEnabled,
                    isDefault: i === 0 && legacyDefault,
                  };
                }
                if (m && typeof m === "object") {
                  const mo = m as Record<string, unknown>;
                  const id = String(mo.id ?? mo.name ?? "");
                  if (!id) return null;
                  return {
                    id,
                    name: String(mo.name ?? mo.label ?? id),
                    enabled:
                      typeof mo.enabled === "boolean"
                        ? mo.enabled
                        : legacyEnabled,
                    isDefault:
                      typeof mo.isDefault === "boolean"
                        ? mo.isDefault
                        : typeof mo.default === "boolean"
                          ? mo.default
                          : i === 0 && legacyDefault,
                  };
                }
                return null;
              })
              .filter((m): m is LlmFormModel => m !== null) as LlmFormModel[])
          : typeof rawModels === "string" && rawModels.trim()
            ? [
                {
                  id: rawModels.trim(),
                  name: rawModels.trim(),
                  enabled: legacyEnabled,
                  isDefault: legacyDefault,
                },
              ]
            : [];
        return {
          id: String(c.id ?? `llm-${index + 1}`),
          name: String(
            c.name ?? c.provider ?? c.apiProvider ?? `LLM ${index + 1}`
          ),
          apiProvider: String(c.apiProvider ?? c.provider ?? "openai-compatible"),
          baseUrl: String(c.baseUrl ?? c.apiUrl ?? c.api ?? ""),
          apiKey: typeof c.apiKey === "string" ? c.apiKey : String(c.key ?? ""),
          models,
          temperature: typeof c.temperature === "number" ? c.temperature : 0.7,
        };
      });
    return configs;
  } catch {
    return [];
  }
}

function parseOssValue(value?: string): OssForm {
  if (!value) return { ...EMPTY_OSS };
  try {
    const parsed = JSON.parse(value) as Partial<OssForm>;
    return {
      bucket: parsed.bucket ?? "",
      domain: parsed.domain ?? "",
      accessKeyId: parsed.accessKeyId ?? "",
      accessKeySecret: parsed.accessKeySecret ?? "",
    };
  } catch {
    return { ...EMPTY_OSS };
  }
}

function parseStorageValue(value?: string, legacyOssValue?: string): StorageForm {
  if (!value && legacyOssValue) {
    const legacy = parseOssValue(legacyOssValue);
    const enabled = !!(
      legacy.bucket &&
      legacy.domain &&
      legacy.accessKeyId &&
      legacy.accessKeySecret
    );
    return {
      defaultProvider: enabled ? "aliyun-oss" : "local",
      providers: {
        local: { enabled: true },
        aliyunOss: { ...legacy, enabled },
      },
    };
  }
  if (!value) return { ...EMPTY_STORAGE, providers: { ...EMPTY_STORAGE.providers, aliyunOss: { ...EMPTY_STORAGE.providers.aliyunOss } } };
  try {
    const parsed = JSON.parse(value) as {
      defaultProvider?: string;
      default?: string;
      providers?: {
        local?: { enabled?: boolean };
        aliyunOss?: Partial<OssForm> & { enabled?: boolean };
        "aliyun-oss"?: Partial<OssForm> & { enabled?: boolean };
        oss?: Partial<OssForm> & { enabled?: boolean };
      };
    };
    const oss =
      parsed.providers?.aliyunOss ??
      parsed.providers?.["aliyun-oss"] ??
      parsed.providers?.oss;
    const aliyunOss = {
      enabled: oss?.enabled === true,
      bucket: oss?.bucket ?? "",
      domain: oss?.domain ?? "",
      accessKeyId: oss?.accessKeyId ?? "",
      accessKeySecret: oss?.accessKeySecret ?? "",
    };
    const defaultProvider =
      (parsed.defaultProvider ?? parsed.default) === "aliyun-oss" &&
      aliyunOss.enabled
        ? "aliyun-oss"
        : "local";
    return {
      defaultProvider,
      providers: {
        local: { enabled: true },
        aliyunOss,
      },
    };
  } catch {
    return { ...EMPTY_STORAGE, providers: { ...EMPTY_STORAGE.providers, aliyunOss: { ...EMPTY_STORAGE.providers.aliyunOss } } };
  }
}

function parseWechatValue(value?: string): WechatForm {
  if (!value) return { ...EMPTY_WECHAT };
  try {
    const parsed = JSON.parse(value) as Partial<WechatForm>;
    return {
      appId: parsed.appId ?? "",
      secret: parsed.secret ?? "",
    };
  } catch {
    return { ...EMPTY_WECHAT };
  }
}

function parseAgentValue(value?: string): AgentForm {
  if (!value) return { ...DEFAULT_AGENT, projects: [] };
  try {
    const parsed = JSON.parse(value) as Partial<AgentForm>;
    return {
      tavilyApiKey:
        typeof parsed.tavilyApiKey === "string" ? parsed.tavilyApiKey : "",
      githubToken:
        typeof parsed.githubToken === "string" ? parsed.githubToken : "",
      projects: Array.isArray(parsed.projects)
        ? parsed.projects.map((project) => ({
            id: String(project.id ?? ""),
            name: String(project.name ?? ""),
            root: String(project.root ?? ""),
          }))
        : [],
      maxSteps:
        typeof parsed.maxSteps === "number" ? parsed.maxSteps : DEFAULT_AGENT.maxSteps,
      contextBudgetTokens:
        typeof parsed.contextBudgetTokens === "number"
          ? parsed.contextBudgetTokens
          : DEFAULT_AGENT.contextBudgetTokens,
    };
  } catch {
    return { ...DEFAULT_AGENT, projects: [] };
  }
}

export function SystemConfigManager({ configs }: { configs?: SystemConfig[] }) {
  const [tab, setTab] = useState<Tab>("llm");
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const [configsState, setConfigsState] = useState<SystemConfig[]>(configs ?? []);
  const [storageInfo, setStorageInfo] = useState<StorageInfo>({ localPath: "" });

  // 客户端自取（脱敏），密钥不会进客户端
  useEffect(() => {
    if (configs) return; // 已由 SSR 提供
    fetch("/api/system-config")
      .then((r) => r.json())
      .then((data) => {
        setConfigsState(data.configs ?? []);
        setStorageInfo(data.storageInfo ?? { localPath: "" });
      })
      .catch(() => {});
  }, [configs]);

  const llmConfig = configsState.find((c) => c.key === LLM_CONFIG_KEY);
  const storageConfig = configsState.find((c) => c.key === STORAGE_CONFIG_KEY);
  const ossConfig = configsState.find((c) => c.key === OSS_CONFIG_KEY);
  const agentConfig = configsState.find((c) => c.key === AGENT_CONFIG_KEY);
  const wechatConfig = configsState.find((c) => c.key === WECHAT_CONFIG_KEY);

  const [llmForms, setLlmForms] = useState<LlmForm[]>(() =>
    parseLlmValue(llmConfig?.value)
  );
  const [storageForm, setStorageForm] = useState<StorageForm>(() =>
    parseStorageValue(storageConfig?.value, ossConfig?.value)
  );
  const [agentForm, setAgentForm] = useState<AgentForm>(() =>
    parseAgentValue(agentConfig?.value)
  );
  const [wechatForm, setWechatForm] = useState<WechatForm>(() =>
    parseWechatValue(wechatConfig?.value)
  );

  // 配置异步加载完成后回填表单
  useEffect(() => {
    setLlmForms(parseLlmValue(llmConfig?.value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configsState]);
  useEffect(() => {
    setStorageForm(parseStorageValue(storageConfig?.value, ossConfig?.value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configsState]);
  useEffect(() => {
    setAgentForm(parseAgentValue(agentConfig?.value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configsState]);
  useEffect(() => {
    setWechatForm(parseWechatValue(wechatConfig?.value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configsState]);

  const llmValue = useMemo(() => JSON.stringify(llmForms, null, 2), [llmForms]);
  const storageValue = useMemo(
    () => JSON.stringify(storageForm, null, 2),
    [storageForm]
  );
  const agentValue = useMemo(
    () => JSON.stringify(agentForm, null, 2),
    [agentForm]
  );
  const wechatValue = useMemo(
    () => JSON.stringify(wechatForm, null, 2),
    [wechatForm]
  );

  function clearMsg() {
    setMessage("");
    setError("");
  }

  async function refreshConfigs() {
    const res = await fetch("/api/system-config");
    const data = await res.json();
    setConfigsState(data.configs ?? []);
    setStorageInfo(data.storageInfo ?? { localPath: "" });
  }

  function saveLlm() {
    clearMsg();
    startTransition(async () => {
      const res = await fetch("/api/system-config", {
        method: llmConfig ? "PUT" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key: LLM_CONFIG_KEY, value: llmValue }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "保存失败。");
        return;
      }
      await refreshConfigs();
      setMessage("AI 模型配置已保存。");
    });
  }

  function saveStorage() {
    clearMsg();
    startTransition(async () => {
      const res = await fetch("/api/system-config", {
        method: storageConfig ? "PUT" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key: STORAGE_CONFIG_KEY, value: storageValue }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "保存失败。");
        return;
      }
      await refreshConfigs();
      setMessage("存储配置已保存。");
    });
  }

  function saveAgent() {
    clearMsg();
    startTransition(async () => {
      const res = await fetch("/api/system-config", {
        method: agentConfig ? "PUT" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key: AGENT_CONFIG_KEY, value: agentValue }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "保存失败。");
        return;
      }
      await refreshConfigs();
      setMessage("写作 Agent 配置已保存。");
    });
  }

  function saveWechat() {
    clearMsg();
    startTransition(async () => {
      const res = await fetch("/api/system-config", {
        method: wechatConfig ? "PUT" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key: WECHAT_CONFIG_KEY, value: wechatValue }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "保存失败。");
        return;
      }
      await refreshConfigs();
      setMessage("微信公众号配置已保存。");
    });
  }

  function testStorage() {
    clearMsg();
    startTransition(async () => {
      const res = await fetch("/api/system-config/test", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "OSS 存储测试失败。");
        return;
      }
      setMessage(data.message || "OSS 存储测试通过。");
    });
  }

  function removeStorageOss() {
    if (!window.confirm("确认清空 OSS 存储配置？默认存储将切回本地。")) return;
    clearMsg();
    const next: StorageForm = {
      ...storageForm,
      defaultProvider: "local",
      providers: {
        ...storageForm.providers,
        aliyunOss: { ...EMPTY_STORAGE.providers.aliyunOss },
      },
    };
    setStorageForm(next);
    startTransition(async () => {
      const res = await fetch("/api/system-config", {
        method: storageConfig ? "PUT" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          key: STORAGE_CONFIG_KEY,
          value: JSON.stringify(next, null, 2),
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "删除失败。");
        return;
      }
      await refreshConfigs();
      setMessage("OSS 存储配置已清空。");
    });
  }

  return (
    <div className="space-y-4">
      {/* 导入导出工具栏 */}
      <div className="flex items-center justify-between gap-3">
        <div className="text-xs text-muted-foreground">
          配置含密钥，请妥善保管。支持加密导出与导入，用于跨机器迁移或备份。
        </div>
        <ConfigImportExport onImported={refreshConfigs} />
      </div>

      {/* Tab 切换 */}
      <div className="flex gap-1 rounded-md bg-muted p-1 w-fit">
        <button
          onClick={() => {
            setTab("agent");
            clearMsg();
          }}
          className={cn(
            "flex items-center gap-1.5 px-4 py-1.5 rounded text-sm font-medium transition-colors",
            tab === "agent"
              ? "bg-background shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          <Bot className="h-4 w-4" />
          写作 Agent
        </button>
        <button
          onClick={() => {
            setTab("llm");
            clearMsg();
          }}
          className={cn(
            "flex items-center gap-1.5 px-4 py-1.5 rounded text-sm font-medium transition-colors",
            tab === "llm"
              ? "bg-background shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          <Sparkles className="h-4 w-4" />
          AI 模型
        </button>
        <button
          onClick={() => {
            setTab("storage");
            clearMsg();
          }}
          className={cn(
            "flex items-center gap-1.5 px-4 py-1.5 rounded text-sm font-medium transition-colors",
            tab === "storage"
              ? "bg-background shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          <Cloud className="h-4 w-4" />
          存储配置
        </button>
        <button
          onClick={() => {
            setTab("wechat");
            clearMsg();
          }}
          className={cn(
            "flex items-center gap-1.5 px-4 py-1.5 rounded text-sm font-medium transition-colors",
            tab === "wechat"
              ? "bg-background shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          <MessageCircle className="h-4 w-4" />
          微信公众号
        </button>
      </div>

      {tab === "llm" ? (
        <LlmEditor
          value={llmForms}
          onChange={setLlmForms}
          onSave={saveLlm}
          pending={pending}
        />
      ) : tab === "agent" ? (
        <AgentEditor
          value={agentForm}
          onChange={setAgentForm}
          onSave={saveAgent}
          pending={pending}
        />
      ) : tab === "wechat" ? (
        <WechatEditor
          value={wechatForm}
          onChange={setWechatForm}
          onSave={saveWechat}
          pending={pending}
          exists={!!wechatConfig}
        />
      ) : (
        <StorageEditor
          value={storageForm}
          localPath={storageInfo.localPath}
          onChange={setStorageForm}
          onSave={saveStorage}
          onTest={testStorage}
          onRemoveOss={removeStorageOss}
          pending={pending}
          ossExists={storageForm.providers.aliyunOss.enabled}
        />
      )}

      {message && (
        <div className="rounded-md bg-emerald-50 border border-emerald-200 px-3 py-2 text-sm text-emerald-700 flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4" />
          {message}
        </div>
      )}
      {error && (
        <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}
    </div>
  );
}

function AgentEditor({
  value,
  onChange,
  onSave,
  pending,
}: {
  value: AgentForm;
  onChange: (value: AgentForm) => void;
  onSave: () => void;
  pending: boolean;
}) {
  function updateProject(index: number, patch: Partial<AgentProjectForm>) {
    onChange({
      ...value,
      projects: value.projects.map((project, i) =>
        i === index ? { ...project, ...patch } : project
      ),
    });
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="text-sm text-muted-foreground max-w-2xl">
          Tavily 用于联网检索；GitHub Token 仅用于提高公开仓库 API
          限额。本地路径可在对话中首次授权，长期信任项目用于免确认访问。写作助手不会执行构建或修改项目文件。
        </p>
        <Button onClick={onSave} disabled={pending} size="sm">
          {pending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          保存配置
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Tavily API Key">
          <Input
            type="password"
            value={value.tavilyApiKey === "********" ? "" : value.tavilyApiKey}
            placeholder={
              value.tavilyApiKey === "********"
                ? "已配置（留空保持不变）"
                : "tvly-..."
            }
            onChange={(event) =>
              onChange({ ...value, tavilyApiKey: event.target.value })
            }
          />
        </Field>
        <Field label="GitHub Token（可选）">
          <Input
            type="password"
            value={value.githubToken === "********" ? "" : value.githubToken}
            placeholder={
              value.githubToken === "********"
                ? "已配置（留空保持不变）"
                : "github_pat_..."
            }
            onChange={(event) =>
              onChange({ ...value, githubToken: event.target.value })
            }
          />
        </Field>
        <Field label="单次 Agent 最大步骤">
          <Input
            type="number"
            min={3}
            max={20}
            value={value.maxSteps}
            onChange={(event) =>
              onChange({ ...value, maxSteps: Number(event.target.value) })
            }
          />
        </Field>
        <Field label="上下文预算（Tokens）">
          <Input
            type="number"
            min={8000}
            max={200000}
            step={1000}
            value={value.contextBudgetTokens}
            onChange={(event) =>
              onChange({
                ...value,
                contextBudgetTokens: Number(event.target.value),
              })
            }
          />
        </Field>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-medium">长期信任项目</div>
            <div className="text-xs text-muted-foreground mt-0.5">
              可选。对话中也能直接输入绝对路径并进行一次性授权。
            </div>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              onChange({
                ...value,
                projects: [
                  ...value.projects,
                  {
                    id: `project-${value.projects.length + 1}`,
                    name: "",
                    root: "",
                  },
                ],
              })
            }
          >
            <Plus className="h-4 w-4" />
            添加项目
          </Button>
        </div>

        {value.projects.length === 0 ? (
          <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
            <FolderCode className="h-6 w-6 mx-auto mb-2 opacity-60" />
            暂无长期信任项目；仍可在对话中临时授权本地路径
          </div>
        ) : (
          value.projects.map((project, index) => (
            <div
              key={`${project.id}-${index}`}
              className="rounded-md border border-border p-4"
            >
              <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
                <Field label="项目 ID">
                  <Input
                    value={project.id}
                    placeholder="datastoria"
                    onChange={(event) =>
                      updateProject(index, { id: event.target.value })
                    }
                  />
                </Field>
                <Field label="显示名称">
                  <Input
                    value={project.name}
                    placeholder="Datastoria"
                    onChange={(event) =>
                      updateProject(index, { name: event.target.value })
                    }
                  />
                </Field>
                <div className="flex items-end">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-red-600"
                    onClick={() =>
                      onChange({
                        ...value,
                        projects: value.projects.filter((_, i) => i !== index),
                      })
                    }
                  >
                    <Trash2 className="h-4 w-4" />
                    移除
                  </Button>
                </div>
              </div>
              <div className="mt-3">
                <Field label="项目绝对路径">
                  <Input
                    value={project.root}
                    className="font-mono text-xs"
                    placeholder="/Users/name/OpenProjects/project"
                    onChange={(event) =>
                      updateProject(index, { root: event.target.value })
                    }
                  />
                </Field>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

/* ------------------------- LLM 编辑器 ------------------------- */

/** 供应商树节点：已配置（来自 llmForms，可拖）或未配置预设（灰显，不可拖）。 */
type ProviderTreeNode = {
  id: string;
  name: string;
  apiProvider: string;
  baseUrl: string;
  apiKey: string;
  models: LlmFormModel[];
  temperature: number;
  isConfigured: boolean;
  isPreset: boolean;
  docsUrl?: string;
  /** 在 llmForms 中的下标；未配置为 -1。 */
  formIndex: number;
};

type ProviderMutations = {
  patchProvider: (node: ProviderTreeNode, patch: Partial<LlmForm>) => void;
  patchModel: (
    node: ProviderTreeNode,
    modelIdx: number,
    patch: Partial<LlmFormModel>
  ) => void;
  setModelDefault: (node: ProviderTreeNode, modelIdx: number) => void;
  setModelEnabled: (
    node: ProviderTreeNode,
    modelIdx: number,
    enabled: boolean
  ) => void;
  addModel: (node: ProviderTreeNode, id: string) => void;
  removeModel: (node: ProviderTreeNode, modelIdx: number) => void;
  removeProvider: (node: ProviderTreeNode) => void;
};

/**
 * 构建供应商树：
 * - 已配置节点（forms 的 DB 顺序，可拖）+ 未配置预设（JSON 原序，灰显）。
 * - 匹配纯按 id：forms.id === preset.id 视为已配置预设。
 */
function buildProviderTree(forms: LlmForm[]): ProviderTreeNode[] {
  const configured: ProviderTreeNode[] = forms.map((f, i) => {
    const preset = LLM_PRESETS.find((p) => p.id === f.id);
    return {
      id: f.id,
      name: f.name,
      apiProvider: f.apiProvider,
      baseUrl: f.baseUrl,
      apiKey: f.apiKey,
      models: f.models,
      temperature: f.temperature,
      isConfigured: true,
      isPreset: Boolean(preset),
      docsUrl: preset?.docsUrl,
      formIndex: i,
    };
  });
  const unconfigured: ProviderTreeNode[] = LLM_PRESETS.filter(
    (p) => !forms.some((f) => f.id === p.id)
  ).map((p) => ({
    id: p.id,
    name: p.name,
    apiProvider: p.apiProvider,
    baseUrl: p.baseUrl,
    apiKey: "",
    models: p.models.map((m, i) => ({
      id: m.id,
      name: m.name,
      enabled: true,
      isDefault: i === 0,
    })),
    temperature: 0.7,
    isConfigured: false,
    isPreset: true,
    docsUrl: p.docsUrl,
    formIndex: -1,
  }));
  return [...configured, ...unconfigured];
}

function LlmEditor({
  value,
  onChange,
  onSave,
  pending,
}: {
  value: LlmForm[];
  onChange: (v: LlmForm[]) => void;
  onSave: () => void;
  pending: boolean;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  const tree = useMemo(() => buildProviderTree(value), [value]);
  const providerItemIds = useMemo(
    () => tree.map((n) => `provider:${n.id}`),
    [tree]
  );

  // 把节点物化进 llmForms（未配置预设首次编辑时），返回物化后的 forms 与下标。
  function ensureForm(
    node: ProviderTreeNode
  ): { forms: LlmForm[]; index: number } {
    if (node.formIndex >= 0) return { forms: value, index: node.formIndex };
    const newForm: LlmForm = {
      id: node.id,
      name: node.name,
      apiProvider: node.apiProvider,
      baseUrl: node.baseUrl,
      apiKey: node.apiKey,
      models: node.models,
      temperature: node.temperature,
    };
    return { forms: [...value, newForm], index: value.length };
  }

  const mutations: ProviderMutations = {
    patchProvider(node, patch) {
      const { forms, index } = ensureForm(node);
      onChange(
        forms.map((f, i) => (i === index ? { ...f, ...patch } : f))
      );
    },
    patchModel(node, modelIdx, patch) {
      const { forms, index } = ensureForm(node);
      onChange(
        forms.map((f, i) =>
          i === index
            ? {
                ...f,
                models: f.models.map((m, j) =>
                  j === modelIdx ? { ...m, ...patch } : m
                ),
              }
            : f
        )
      );
    },
    setModelDefault(node, modelIdx) {
      // 全局唯一默认：清空所有模型 isDefault，仅置目标；默认模型同时启用。
      const { forms, index } = ensureForm(node);
      onChange(
        forms.map((f, i) => ({
          ...f,
          models: f.models.map((m, j) => ({
            ...m,
            isDefault: i === index && j === modelIdx,
            enabled: i === index && j === modelIdx ? true : m.enabled,
          })),
        }))
      );
    },
    setModelEnabled(node, modelIdx, enabled) {
      const { forms, index } = ensureForm(node);
      let next = forms.map((f, i) =>
        i === index
          ? {
              ...f,
              models: f.models.map((m, j) =>
                j === modelIdx ? { ...m, enabled } : m
              ),
            }
          : f
      );
      if (!enabled) {
        const disabledModel = next[index].models[modelIdx];
        if (disabledModel.isDefault) {
          // 跨供应商首个 enabled 非默认模型提为新 default；找不到则留空（后端兜底）
          const candidate = next
            .flatMap((f) => f.models)
            .find((m) => m.enabled && m !== disabledModel);
          next = next.map((f) => ({
            ...f,
            models: f.models.map((m) => ({
              ...m,
              isDefault: m === candidate,
            })),
          }));
        }
      }
      onChange(next);
    },
    addModel(node, id) {
      const trimmed = id.trim();
      if (!trimmed) return;
      const { forms, index } = ensureForm(node);
      if (forms[index].models.some((m) => m.id === trimmed)) return;
      onChange(
        forms.map((f, i) =>
          i === index
            ? {
                ...f,
                models: [
                  ...f.models,
                  { id: trimmed, name: trimmed, enabled: true, isDefault: false },
                ],
              }
            : f
        )
      );
    },
    removeModel(node, modelIdx) {
      const { forms, index } = ensureForm(node);
      const removing = forms[index].models[modelIdx];
      let next = forms.map((f, i) =>
        i === index
          ? { ...f, models: f.models.filter((_, j) => j !== modelIdx) }
          : f
      );
      if (removing.isDefault) {
        const candidate = next.flatMap((f) => f.models).find((m) => m.enabled);
        next = next.map((f) => ({
          ...f,
          models: f.models.map((m) => ({ ...m, isDefault: m === candidate })),
        }));
      }
      onChange(next);
    },
    removeProvider(node) {
      if (node.formIndex < 0) return;
      // 移除后若该供应商曾持有全局默认，由后端 parseLlmConfigs 兜底重选
      onChange(value.filter((_, i) => i !== node.formIndex));
    },
  };

  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const aid = String(active.id);
    const oid = String(over.id);
    if (aid.startsWith("provider:") && oid.startsWith("provider:")) {
      const from = value.findIndex((f) => `provider:${f.id}` === aid);
      const to = value.findIndex((f) => `provider:${f.id}` === oid);
      if (from < 0 || to < 0) return; // 涉及未配置预设 → 不允许拖拽
      onChange(arrayMove(value, from, to));
    } else if (aid.startsWith("model:") && oid.startsWith("model:")) {
      const aParts = aid.split(":");
      const oParts = oid.split(":");
      const aPid = aParts[1];
      const oPid = oParts[1];
      if (aPid !== oPid) return; // 跨供应商拖模型 → 弹回
      const fi = value.findIndex((f) => f.id === aPid);
      if (fi < 0) return;
      const aMid = aParts.slice(2).join(":");
      const oMid = oParts.slice(2).join(":");
      const mFrom = value[fi].models.findIndex((m) => m.id === aMid);
      const mTo = value[fi].models.findIndex((m) => m.id === oMid);
      if (mFrom < 0 || mTo < 0) return;
      onChange(
        value.map((f, i) =>
          i === fi ? { ...f, models: arrayMove(f.models, mFrom, mTo) } : f
        )
      );
    }
  }

  function addCustomProvider() {
    const id = `llm-${Date.now().toString(36)}`;
    onChange([...value, { ...EMPTY_LLM_PROVIDER, id, name: "" }]);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground max-w-2xl">
          配置 OpenAI、智谱 GLM、DeepSeek 等 OpenAI 兼容协议的模型供应商。
          启用/默认在模型级，可拖拽供应商与模型排序；下拉顺序跟随本树。
        </p>
        <Button onClick={onSave} disabled={pending} size="sm">
          {pending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          保存配置
        </Button>
      </div>

      <DndContext
        id="llm-editor"
        sensors={sensors}
        collisionDetection={closestCorners}
        modifiers={[restrictToVerticalAxis]}
        onDragEnd={onDragEnd}
      >
        <SortableContext
          items={providerItemIds}
          strategy={verticalListSortingStrategy}
        >
          <div className="space-y-2">
            {tree.map((node) => (
              <ProviderRow key={node.id} node={node} mutations={mutations} />
            ))}
          </div>
        </SortableContext>
      </DndContext>

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={addCustomProvider}
      >
        <Plus className="h-4 w-4" />
        添加自定义供应商
      </Button>
    </div>
  );
}

/** 供应商行：可拖拽（配置后）+ 折叠表单。未配置预设灰显、禁用拖拽。 */
function ProviderRow({
  node,
  mutations,
}: {
  node: ProviderTreeNode;
  mutations: ProviderMutations;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({
      id: `provider:${node.id}`,
      disabled: !node.isConfigured,
    });
  const [open, setOpen] = useState(
    node.isConfigured && node.models.length === 0
  );
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };
  const enabledCount = node.models.filter((m) => m.enabled).length;

  return (
    <Collapsible
      ref={setNodeRef}
      style={style}
      open={open}
      onOpenChange={setOpen}
      className={cn(
        "rounded-md border border-border bg-card",
        !node.isConfigured && "opacity-60"
      )}
    >
      <div className="flex items-center gap-1.5 px-2 py-2.5">
        <button
          type="button"
          aria-label="拖动供应商排序"
          className={cn(
            "shrink-0 cursor-grab text-muted-foreground hover:text-foreground active:cursor-grabbing",
            !node.isConfigured && "invisible"
          )}
          {...attributes}
          {...listeners}
        >
          <GripVertical className="h-4 w-4" />
        </button>
        <CollapsibleTrigger
          hideIcon
          className="flex flex-1 items-center gap-2 text-left outline-none"
        >
          <span
            className={cn(
              "truncate text-sm font-medium",
              !node.isConfigured && "text-muted-foreground"
            )}
          >
            {node.name || node.id || "未命名供应商"}
          </span>
          {!node.isConfigured && (
            <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
              未配置
            </Badge>
          )}
          {node.isConfigured && node.models.some((m) => m.isDefault) && (
            <Badge variant="default" className="px-1.5 py-0 text-[10px]">
              默认
            </Badge>
          )}
          {node.isConfigured && (
            <span className="text-xs text-muted-foreground">
              {node.models.length} 个模型
              {enabledCount < node.models.length ? `（${enabledCount} 启用）` : ""}
            </span>
          )}
        </CollapsibleTrigger>
        <CollapsibleTrigger
          hideIcon
          aria-label={open ? "收起" : "展开"}
          className="shrink-0 w-auto p-1 text-muted-foreground"
        >
          <ChevronDown
            className={cn(
              "h-4 w-4 transition-transform",
              open && "rotate-180"
            )}
          />
        </CollapsibleTrigger>
      </div>
      <CollapsibleContent>
        <div className="space-y-3 border-t border-border px-3 py-3">
          <ProviderFormFields node={node} mutations={mutations} />
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

/** 供应商展开内容：连接字段 + 模型列表（嵌套可拖）+ 添加模型 + 移除。 */
function ProviderFormFields({
  node,
  mutations,
}: {
  node: ProviderTreeNode;
  mutations: ProviderMutations;
}) {
  const [newModelId, setNewModelId] = useState("");
  const apiKeyMasked = node.apiKey === "********";
  const modelIds = node.models.map((m) => `model:${node.id}:${m.id}`);

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="API Key">
          <Input
            type="password"
            value={apiKeyMasked ? "" : node.apiKey}
            placeholder={
              apiKeyMasked ? "已配置（留空保持不变）" : "sk-..."
            }
            onChange={(e) =>
              mutations.patchProvider(node, { apiKey: e.target.value })
            }
            className="h-9"
          />
        </Field>
        <Field label="Base URL">
          <Input
            value={node.baseUrl}
            placeholder="https://api.deepseek.com/v1"
            onChange={(e) =>
              mutations.patchProvider(node, { baseUrl: e.target.value })
            }
            className="h-9"
          />
        </Field>
        <Field label="API 协议">
          <Input
            value={node.apiProvider}
            placeholder="openai-compatible"
            onChange={(e) =>
              mutations.patchProvider(node, { apiProvider: e.target.value })
            }
            className="h-9"
          />
        </Field>
        <Field label="显示名称">
          <Input
            value={node.name}
            placeholder="DeepSeek"
            onChange={(e) =>
              mutations.patchProvider(node, { name: e.target.value })
            }
            className="h-9"
          />
        </Field>
        <Field label="Temperature">
          <Input
            type="number"
            min={0}
            max={2}
            step={0.1}
            value={node.temperature}
            onChange={(e) =>
              mutations.patchProvider(node, {
                temperature: Number(e.target.value),
              })
            }
            className="h-9"
          />
        </Field>
        {node.docsUrl && (
          <div className="flex items-end">
            <a
              href={node.docsUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
            >
              <ExternalLink className="h-3 w-3" />
              获取密钥
            </a>
          </div>
        )}
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-muted-foreground">
            模型（启用 / 默认在模型级，可拖拽排序）
          </span>
        </div>
        <SortableContext items={modelIds} strategy={verticalListSortingStrategy}>
          {node.models.length === 0 ? (
            <div className="rounded-md border border-dashed px-3 py-3 text-center text-xs text-muted-foreground">
              暂无模型，添加一个模型 ID 开始使用
            </div>
          ) : (
            node.models.map((m, idx) => (
              <ModelRow
                key={m.id}
                node={node}
                modelIdx={idx}
                mutations={mutations}
              />
            ))
          )}
        </SortableContext>
        <div className="flex gap-2">
          <Input
            value={newModelId}
            placeholder="模型 id，如 gpt-4o"
            onChange={(e) => setNewModelId(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                mutations.addModel(node, newModelId);
                setNewModelId("");
              }
            }}
            className="h-9"
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              mutations.addModel(node, newModelId);
              setNewModelId("");
            }}
          >
            <Plus className="h-3.5 w-3.5" />
            添加模型
          </Button>
        </div>
      </div>

      {node.isConfigured && (
        <div className="flex justify-end">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-red-600 hover:text-red-700"
            onClick={() => mutations.removeProvider(node)}
          >
            <Trash2 className="h-3.5 w-3.5" />
            {node.isPreset ? "移除（回到未配置）" : "移除供应商"}
          </Button>
        </div>
      )}
    </>
  );
}

/** 模型行：拖柄 + id 标签 + 名称 + 启用 + 默认 + 删除。 */
function ModelRow({
  node,
  modelIdx,
  mutations,
}: {
  node: ProviderTreeNode;
  modelIdx: number;
  mutations: ProviderMutations;
}) {
  const model = node.models[modelIdx];
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({
      id: `model:${node.id}:${model.id}`,
      disabled: !node.isConfigured,
    });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };
  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex flex-wrap items-center gap-2 rounded-md border border-border px-2 py-1.5"
    >
      <button
        type="button"
        aria-label="拖动模型排序"
        className={cn(
          "shrink-0 cursor-grab text-muted-foreground hover:text-foreground active:cursor-grabbing",
          !node.isConfigured && "invisible"
        )}
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-3.5 w-3.5" />
      </button>
      <span
        className="max-w-[40%] truncate rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground"
        title={model.id}
      >
        {model.id}
      </span>
      <Input
        value={model.name}
        placeholder={model.id}
        onChange={(e) =>
          mutations.patchModel(node, modelIdx, { name: e.target.value })
        }
        className="h-8 min-w-[120px] flex-1 text-xs"
      />
      <label className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
        <Switch
          checked={model.enabled}
          onCheckedChange={(v) =>
            mutations.setModelEnabled(node, modelIdx, v)
          }
          aria-label="启用模型"
        />
        启用
      </label>
      <label className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
        <input
          type="radio"
          name="llm-global-default"
          checked={model.isDefault}
          onChange={() => mutations.setModelDefault(node, modelIdx)}
          aria-label="设为默认模型"
          className="h-3.5 w-3.5"
        />
        默认
      </label>
      <button
        type="button"
        aria-label="删除模型"
        onClick={() => mutations.removeModel(node, modelIdx)}
        className="shrink-0 p-1 text-red-600 hover:text-red-700"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

/* ------------------------- 存储编辑器 ------------------------- */

function StorageEditor({
  value,
  localPath,
  onChange,
  onSave,
  onTest,
  onRemoveOss,
  pending,
  ossExists,
}: {
  value: StorageForm;
  localPath: string;
  onChange: (v: StorageForm) => void;
  onSave: () => void;
  onTest: () => void;
  onRemoveOss: () => void;
  pending: boolean;
  ossExists: boolean;
}) {
  const [storageTab, setStorageTab] = useState<"local" | "aliyun-oss">(
    value.defaultProvider
  );
  const oss = value.providers.aliyunOss;
  function updateOss(next: Partial<OssForm & { enabled: boolean }>) {
    const aliyunOss = { ...oss, ...next };
    onChange({
      ...value,
      defaultProvider:
        value.defaultProvider === "aliyun-oss" && !aliyunOss.enabled
          ? "local"
          : value.defaultProvider,
      providers: {
        ...value.providers,
        aliyunOss,
      },
    });
  }
  function setDefaultProvider(provider: "local" | "aliyun-oss") {
    if (provider === "aliyun-oss") {
      updateOss({ enabled: true });
    }
    onChange({
      ...value,
      defaultProvider: provider,
      providers: {
        ...value.providers,
        aliyunOss: {
          ...value.providers.aliyunOss,
          enabled: provider === "aliyun-oss" ? true : value.providers.aliyunOss.enabled,
        },
      },
    });
  }
  const fields: Array<{
    key: keyof OssForm;
    label: string;
    placeholder: string;
    type?: string;
    full?: boolean;
  }> = [
    { key: "bucket", label: "Bucket", placeholder: "inkpress-assets" },
    {
      key: "domain",
      label: "Domain（自定义 CDN 域名或 OSS 默认域名）",
      placeholder: "https://cdn.example.com 或 https://bucket.oss-cn-hangzhou.aliyuncs.com",
      full: true,
    },
    { key: "accessKeyId", label: "AccessKeyId", placeholder: "LTAI..." },
    {
      key: "accessKeySecret",
      label: "AccessKeySecret",
      placeholder: "AccessKeySecret",
      type: "password",
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground max-w-xl">
          统一管理文章素材（图片、视频、音频、附件）的实际存储位置。上传文件时不再选择存储类型，系统会写入当前默认存储；代码解析、代码图谱和运行缓存仍保留在本地数据目录。
        </p>
        <div className="flex gap-2">
          {ossExists && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onRemoveOss}
              disabled={pending}
              className="text-red-600 hover:text-red-700"
            >
              <Trash2 className="h-4 w-4" />
              清空 OSS
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onTest}
            disabled={pending || !ossExists}
          >
            <CheckCircle2 className="h-4 w-4" />
            测试 OSS
          </Button>
          <Button onClick={onSave} disabled={pending} size="sm">
            {pending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            保存配置
          </Button>
        </div>
      </div>

      <div className="flex gap-1 rounded-md bg-muted p-1 w-fit">
        <button
          type="button"
          onClick={() => setStorageTab("local")}
          className={cn(
            "px-3 py-1.5 rounded text-xs font-medium transition-colors",
            storageTab === "local"
              ? "bg-background shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          本地存储
        </button>
        <button
          type="button"
          onClick={() => setStorageTab("aliyun-oss")}
          className={cn(
            "px-3 py-1.5 rounded text-xs font-medium transition-colors",
            storageTab === "aliyun-oss"
              ? "bg-background shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          OSS 存储
        </button>
      </div>

      {storageTab === "local" ? (
        <div className="space-y-4">
          <div className="grid gap-3">
            <Field label="本地数据文件路径" full>
              <Input value={localPath || "加载中..."} readOnly className="h-9 font-mono text-xs" />
            </Field>
          </div>
          <div className="flex items-center justify-between rounded-md border p-3">
            <div>
              <div className="text-sm font-medium">设为默认存储</div>
              <div className="text-xs text-muted-foreground">
                新上传的文章素材会写入本地数据目录；已有素材不迁移。
              </div>
            </div>
            <Switch
              checked={value.defaultProvider === "local"}
              onCheckedChange={(checked) => {
                if (checked) setDefaultProvider("local");
              }}
            />
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            {fields.map((field) => (
              <Field key={field.key} label={field.label} full={field.full}>
                <Input
                  value={
                    field.type === "password" && oss[field.key] === "********"
                      ? ""
                      : oss[field.key]
                  }
                  type={field.type ?? "text"}
                  placeholder={
                    field.type === "password" && oss[field.key] === "********"
                      ? "已配置（留空保持不变）"
                      : field.placeholder
                  }
                  onChange={(e) =>
                    updateOss({ enabled: true, [field.key]: e.target.value })
                  }
                  className="h-9"
                />
              </Field>
            ))}
          </div>
          <div className="flex items-center justify-between rounded-md border p-3">
            <div>
              <div className="text-sm font-medium">设为默认存储</div>
              <div className="text-xs text-muted-foreground">
                新上传的文章素材将直接写入 OSS；已有素材不迁移，本地仍用于代码图谱和运行缓存。
              </div>
            </div>
            <Switch
              checked={value.defaultProvider === "aliyun-oss"}
              onCheckedChange={(checked) => {
                if (checked) setDefaultProvider("aliyun-oss");
                else setDefaultProvider("local");
              }}
            />
          </div>
        </div>
      )}

      <div className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
        当前默认存储：{value.defaultProvider === "aliyun-oss" ? "OSS 存储" : "本地存储"}。修改后仅对新上传素材生效。
      </div>
    </div>
  );
}

/* ------------------------- 微信公众号编辑器 ------------------------- */

function WechatEditor({
  value,
  onChange,
  onSave,
  pending,
  exists,
}: {
  value: WechatForm;
  onChange: (v: WechatForm) => void;
  onSave: () => void;
  pending: boolean;
  exists: boolean;
}) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground max-w-xl">
          配置微信公众号凭证（appId 与 secret），用于发布草稿到公众号。凭证加密存储于本地数据库，不会上传。
        </p>
        <Button onClick={onSave} disabled={pending} size="sm">
          {pending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          保存配置
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="AppID">
          <Input
            value={value.appId}
            placeholder="wx5c9f70e0abf6855a"
            onChange={(e) => onChange({ ...value, appId: e.target.value })}
            className="h-9 font-mono text-xs"
          />
        </Field>
        <Field label="AppSecret">
          <Input
            value={value.secret === "********" ? "" : value.secret}
            type="password"
            placeholder={
              exists && value.secret === "********"
                ? "已配置（留空保持不变）"
                : "公众号 AppSecret"
            }
            onChange={(e) => onChange({ ...value, secret: e.target.value })}
            className="h-9 font-mono text-xs"
          />
        </Field>
      </div>
      <p className="text-xs text-muted-foreground">
        在微信公众平台 → 基本配置 → 公众号开发信息中获取。IP 需加入白名单才能获取 access_token。
      </p>
    </div>
  );
}

/* ------------------------- 通用字段 ------------------------- */

function Field({
  label,
  children,
  full,
}: {
  label: string;
  children: React.ReactNode;
  full?: boolean;
}) {
  return (
    <div className={cn("space-y-1.5", full && "sm:col-span-2")}>
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}
