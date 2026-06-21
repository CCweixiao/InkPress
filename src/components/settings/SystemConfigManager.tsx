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
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

export const LLM_CONFIG_KEY = "inkpress.llm";
export const OSS_CONFIG_KEY = "inkpress.oss";
export const AGENT_CONFIG_KEY = "inkpress.agent";
export const WECHAT_CONFIG_KEY = "inkpress.wechat";

type Tab = "llm" | "agent" | "oss" | "wechat";

type SystemConfig = {
  id: string;
  key: string;
  value: string;
  createdAt: string;
  updatedAt: string;
};

type LlmForm = {
  id: string;
  name: string;
  apiProvider: string;
  baseUrl: string;
  apiKey: string;
  model: string[];
  enabled: boolean;
  default: boolean;
  temperature: number;
};

type OssForm = {
  bucket: string;
  domain: string;
  accessKeyId: string;
  accessKeySecret: string;
};

type AgentProjectForm = {
  id: string;
  name: string;
  root: string;
};

type AgentForm = {
  tavilyApiKey: string;
  projects: AgentProjectForm[];
  maxSteps: number;
  contextBudgetTokens: number;
};

type WechatForm = {
  appId: string;
  secret: string;
};

const DEFAULT_LLM: LlmForm = {
  id: "zhipu-glm",
  name: "智谱 GLM",
  apiProvider: "openai-compatible",
  baseUrl: "https://open.bigmodel.cn/api/paas/v4",
  apiKey: "",
  model: ["glm-4.6"],
  enabled: true,
  default: true,
  temperature: 0.7,
};

const EMPTY_OSS: OssForm = {
  bucket: "",
  domain: "",
  accessKeyId: "",
  accessKeySecret: "",
};

const EMPTY_WECHAT: WechatForm = {
  appId: "",
  secret: "",
};

const DEFAULT_AGENT: AgentForm = {
  tavilyApiKey: "",
  projects: [],
  maxSteps: 12,
  contextBudgetTokens: 32000,
};

const PRESET_LLM: Array<Partial<LlmForm> & { id: string; name: string }> = [
  {
    id: "openai",
    name: "OpenAI",
    apiProvider: "openai-compatible",
    baseUrl: "https://api.openaiai.net/v1",
    model: ["gpt-4o", "gpt-4o-mini"],
  },
  {
    id: "zhipu-glm",
    name: "智谱 GLM",
    apiProvider: "openai-compatible",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    model: ["glm-4.6", "glm-4.5"],
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    apiProvider: "openai-compatible",
    baseUrl: "https://api.deepseek.com/v1",
    model: ["deepseek-chat", "deepseek-reasoner"],
  },
];

function parseLlmValue(value?: string): LlmForm[] {
  if (!value) return [{ ...DEFAULT_LLM }];
  try {
    const parsed = JSON.parse(value);
    const items = Array.isArray(parsed) ? parsed : [parsed];
    const configs = items
      .filter((item) => item && typeof item === "object")
      .map((item, index) => {
        const c = item as Record<string, unknown> & {
          isDefault?: boolean;
          apiUrl?: string;
          api?: string;
          key?: string;
          provider?: string;
        };
        const rawModel = (c.models ?? c.model) as unknown;
        const models = Array.isArray(rawModel)
          ? rawModel
              .map((m) => {
                if (typeof m === "string") return m;
                if (m && typeof m === "object") {
                  const mo = m as Record<string, unknown>;
                  return String(mo.id ?? mo.name ?? "");
                }
                return "";
              })
              .filter(Boolean)
          : typeof rawModel === "string" && rawModel.trim()
            ? [rawModel.trim()]
            : [];
        return {
          id: String(c.id ?? `llm-${index + 1}`),
          name: String(c.name ?? c.provider ?? c.apiProvider ?? `LLM ${index + 1}`),
          apiProvider: String(c.apiProvider ?? c.provider ?? "openai-compatible"),
          baseUrl: String(c.baseUrl ?? c.apiUrl ?? c.api ?? ""),
          apiKey: typeof c.apiKey === "string" ? c.apiKey : String(c.key ?? ""),
          model: models,
          enabled: typeof c.enabled === "boolean" ? c.enabled : true,
          default: Boolean(c.default ?? c.isDefault),
          temperature: typeof c.temperature === "number" ? c.temperature : 0.7,
        };
      });
    return configs.length ? configs : [{ ...DEFAULT_LLM }];
  } catch {
    return [{ ...DEFAULT_LLM }];
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

  // 客户端自取（脱敏），密钥不会进客户端
  useEffect(() => {
    if (configs) return; // 已由 SSR 提供
    fetch("/api/system-config")
      .then((r) => r.json())
      .then((data) => setConfigsState(data.configs ?? []))
      .catch(() => {});
  }, [configs]);

  const llmConfig = configsState.find((c) => c.key === LLM_CONFIG_KEY);
  const ossConfig = configsState.find((c) => c.key === OSS_CONFIG_KEY);
  const agentConfig = configsState.find((c) => c.key === AGENT_CONFIG_KEY);
  const wechatConfig = configsState.find((c) => c.key === WECHAT_CONFIG_KEY);

  const [llmForms, setLlmForms] = useState<LlmForm[]>(() =>
    parseLlmValue(llmConfig?.value)
  );
  const [ossForm, setOssForm] = useState<OssForm>(() =>
    parseOssValue(ossConfig?.value)
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
    setOssForm(parseOssValue(ossConfig?.value));
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
  const ossValue = useMemo(() => JSON.stringify(ossForm, null, 2), [ossForm]);
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

  function saveOss() {
    clearMsg();
    startTransition(async () => {
      const res = await fetch("/api/system-config", {
        method: ossConfig ? "PUT" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key: OSS_CONFIG_KEY, value: ossValue }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "保存失败。");
        return;
      }
      await refreshConfigs();
      setMessage("OSS 配置已保存。");
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

  function testOss() {
    clearMsg();
    startTransition(async () => {
      const res = await fetch("/api/system-config/test", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "OSS 配置测试失败。");
        return;
      }
      setMessage(data.message || "OSS 配置测试通过。");
    });
  }

  function removeOss() {
    if (!ossConfig || !window.confirm("确认删除 OSS 配置？")) return;
    clearMsg();
    startTransition(async () => {
      const res = await fetch("/api/system-config", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key: OSS_CONFIG_KEY }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "删除失败。");
        return;
      }
      await refreshConfigs();
      setOssForm({ ...EMPTY_OSS });
      setMessage("OSS 配置已删除。");
    });
  }

  return (
    <div className="space-y-4">
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
            setTab("oss");
            clearMsg();
          }}
          className={cn(
            "flex items-center gap-1.5 px-4 py-1.5 rounded text-sm font-medium transition-colors",
            tab === "oss"
              ? "bg-background shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          <Cloud className="h-4 w-4" />
          OSS 存储
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
        <OssEditor
          value={ossForm}
          onChange={setOssForm}
          onSave={saveOss}
          onTest={testOss}
          onRemove={removeOss}
          pending={pending}
          exists={!!ossConfig}
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
          Tavily 用于联网检索；本地项目采用严格白名单只读访问。写作助手不会执行
          Shell、构建或修改项目文件。
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

      <div className="grid gap-3 sm:grid-cols-3">
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
            <div className="text-sm font-medium">本地项目白名单</div>
            <div className="text-xs text-muted-foreground mt-0.5">
              目录必须是运行 InkPress 的服务器可访问的绝对路径。
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
            暂未配置可供写作助手分析的本地项目
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
  function update(index: number, patch: Partial<LlmForm>) {
    onChange(
      value
        .map((item, i) =>
          i === index
            ? patch.default
              ? { ...item, ...patch, enabled: true }
              : { ...item, ...patch }
            : item
        )
        .map((item, i) =>
          patch.default && i !== index ? { ...item, default: false } : item
        )
    );
  }
  function remove(index: number) {
    onChange(value.filter((_, i) => i !== index));
  }
  function addPreset(preset: (typeof PRESET_LLM)[number]) {
    if (value.some((item) => item.id === preset.id)) return;
    onChange([
      ...value,
      {
        ...DEFAULT_LLM,
        ...preset,
        apiKey: "",
        enabled: true,
        default: false,
        temperature: 0.7,
      } as LlmForm,
    ]);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm text-muted-foreground">
            配置 OpenAI、智谱 GLM、DeepSeek 等 OpenAI 兼容协议的模型供应商。
            可配多个，选择一个为「默认」。
          </p>
        </div>
        <Button onClick={onSave} disabled={pending} size="sm">
          {pending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          保存配置
        </Button>
      </div>

      {/* 快捷预设 */}
      <div className="flex flex-wrap gap-2">
        <span className="text-xs text-muted-foreground self-center mr-1">
          快捷添加：
        </span>
        {PRESET_LLM.map((preset) => {
          const added = value.some((item) => item.id === preset.id);
          return (
            <Button
              key={preset.id}
              type="button"
              variant="outline"
              size="sm"
              disabled={added}
              onClick={() => addPreset(preset)}
            >
              <Plus className="h-3.5 w-3.5" />
              {preset.name}
              {added && "（已添加）"}
            </Button>
          );
        })}
      </div>

      {value.map((item, index) => (
        <div
          key={index}
          className="rounded-md border border-border p-4 space-y-3"
        >
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold">
              供应商 {index + 1}
              {item.default && (
                <span className="ml-2 text-xs text-primary">（默认）</span>
              )}
            </span>
            <button
              type="button"
              onClick={() => remove(index)}
              className="inline-flex items-center gap-1 text-xs text-red-600 hover:underline"
            >
              <Trash2 className="h-3.5 w-3.5" />
              移除
            </button>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="ID（唯一标识）">
              <Input
                value={item.id}
                placeholder="deepseek"
                onChange={(e) => update(index, { id: e.target.value })}
                className="h-9"
              />
            </Field>
            <Field label="显示名称">
              <Input
                value={item.name}
                placeholder="DeepSeek"
                onChange={(e) => update(index, { name: e.target.value })}
                className="h-9"
              />
            </Field>
            <Field label="Base URL">
              <Input
                value={item.baseUrl}
                placeholder="https://api.deepseek.com/v1"
                onChange={(e) => update(index, { baseUrl: e.target.value })}
                className="h-9"
              />
            </Field>
            <Field label="API Key">
              <Input
                value={item.apiKey === "********" ? "" : item.apiKey}
                type="password"
                placeholder={item.apiKey === "********" ? "已配置（留空保持不变）" : "sk-..."}
                onChange={(e) => update(index, { apiKey: e.target.value })}
                className="h-9"
              />
            </Field>
            <Field label="模型列表（每行一个）" full>
              <Textarea
                value={item.model.join("\n")}
                placeholder={"deepseek-chat\ndeepseek-reasoner"}
                rows={Math.max(2, item.model.length)}
                onChange={(e) =>
                  update(index, {
                    model: e.target.value
                      .split("\n")
                      .map((s) => s.trim())
                      .filter(Boolean),
                  })
                }
                className="font-mono text-xs"
              />
            </Field>
            <Field label="Temperature">
              <Input
                value={item.temperature}
                type="number"
                min={0}
                max={2}
                step={0.1}
                onChange={(e) =>
                  update(index, { temperature: Number(e.target.value) })
                }
                className="h-9"
              />
            </Field>
            <div className="flex items-end gap-4 pb-1">
              <label className="inline-flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={item.enabled}
                  onChange={(e) => update(index, { enabled: e.target.checked })}
                />
                启用
              </label>
              <label className="inline-flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={item.default}
                  onChange={(e) => update(index, { default: e.target.checked })}
                />
                默认
              </label>
            </div>
          </div>
        </div>
      ))}

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() =>
          onChange([
            ...value,
            {
              ...DEFAULT_LLM,
              id: `llm-${value.length + 1}`,
              name: `LLM ${value.length + 1}`,
              baseUrl: "",
              model: [],
              default: false,
            },
          ])
        }
      >
        <Plus className="h-4 w-4" />
        添加自定义供应商
      </Button>
    </div>
  );
}

/* ------------------------- OSS 编辑器 ------------------------- */

function OssEditor({
  value,
  onChange,
  onSave,
  onTest,
  onRemove,
  pending,
  exists,
}: {
  value: OssForm;
  onChange: (v: OssForm) => void;
  onSave: () => void;
  onTest: () => void;
  onRemove: () => void;
  pending: boolean;
  exists: boolean;
}) {
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
          配置阿里云 OSS，用于上传文章配图、视频等素材。编辑器粘贴图片会优先上传到
          OSS 拿稳定外链，发布时自动转成公众号 src。
        </p>
        <div className="flex gap-2">
          {exists && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onRemove}
              disabled={pending}
              className="text-red-600 hover:text-red-700"
            >
              <Trash2 className="h-4 w-4" />
              删除
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onTest}
            disabled={pending || !exists}
          >
            <CheckCircle2 className="h-4 w-4" />
            测试连接
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

      <div className="grid gap-3 sm:grid-cols-2">
        {fields.map((field) => (
          <Field key={field.key} label={field.label} full={field.full}>
            <Input
              value={
                field.type === "password" && value[field.key] === "********"
                  ? ""
                  : value[field.key]
              }
              type={field.type ?? "text"}
              placeholder={
                field.type === "password" && value[field.key] === "********"
                  ? "已配置（留空保持不变）"
                  : field.placeholder
              }
              onChange={(e) =>
                onChange({ ...value, [field.key]: e.target.value })
              }
              className="h-9"
            />
          </Field>
        ))}
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
