"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { RefreshCw, ArrowDownToLine, Search, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type LogFile = { name: string; size: number; mtime: string };

/** 把 pino JSON 行渲染为可读的单行（带级别着色） */
function renderLine(line: string) {
  let parsed: Record<string, unknown> | null = null;
  try {
    parsed = JSON.parse(line);
  } catch {
    return { level: "raw", text: line, time: "", msg: line, color: "text-muted-foreground" };
  }
  const level = String(parsed?.level ?? "info");
  const msg = String(parsed?.msg ?? "");
  const time = parsed?.time
    ? new Date(
        typeof parsed.time === "string" ? parsed.time : Number(parsed.time)
      ).toLocaleTimeString("zh-CN", { hour12: false })
    : "";
  // 简化展示：时间 [级别] module msg
  const module = parsed?.module ? `[${parsed.module}]` : "";
  const text = `${time} ${level.toUpperCase().padEnd(5)} ${module} ${msg}`;
  const color =
    level === "error"
      ? "text-red-600"
      : level === "warn"
        ? "text-amber-600"
        : level === "debug" || level === "trace"
          ? "text-slate-400"
          : "text-foreground";
  return { level, text, time, msg, color, module: parsed?.module };
}

export function LogsViewer() {
  const [files, setFiles] = useState<LogFile[]>([]);
  const [currentFile, setCurrentFile] = useState<string>("");
  const [lines, setLines] = useState<string[]>([]);
  const [level, setLevel] = useState("");
  const [query, setQuery] = useState("");
  const [autoScroll, setAutoScroll] = useState(true);
  const [streaming, setStreaming] = useState(true);
  const [loading, setLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  /** 拉取文件列表 + 初始尾部内容 */
  const fetchLogs = useCallback(
    async (file?: string) => {
      setLoading(true);
      const params = new URLSearchParams({ lines: "300" });
      if (file) params.set("file", file);
      if (level) params.set("level", level);
      if (query) params.set("q", query);
      try {
        const res = await fetch(`/api/logs?${params}`);
        const data = await res.json();
        setFiles(data.files ?? []);
        if (data.currentFile) setCurrentFile(data.currentFile);
        setLines(data.lines ?? []);
      } finally {
        setLoading(false);
      }
    },
    [level, query]
  );

  // 初始加载
  useEffect(() => {
    void fetchLogs();
  }, [fetchLogs]);

  // SSE 实时流（监听当前文件的新增行）
  useEffect(() => {
    if (!streaming || !currentFile) return;
    const params = new URLSearchParams({ stream: "1", file: currentFile });
    if (level) params.set("level", level);
    if (query) params.set("q", query);
    const es = new EventSource(`/api/logs?${params}`);
    eventSourceRef.current = es;
    es.onmessage = (ev) => {
      setLines((prev) => {
        const next = [...prev, ev.data];
        // 限制内存中的行数，避免无限增长
        return next.length > 2000 ? next.slice(-2000) : next;
      });
    };
    return () => es.close();
  }, [streaming, currentFile, level, query]);

  // 自动滚动到底部
  useEffect(() => {
    if (autoScroll && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [lines, autoScroll]);

  function switchFile(f: string) {
    setLines([]);
    setCurrentFile(f);
    void fetchLogs(f);
  }

  function refresh() {
    void fetchLogs(currentFile);
  }

  const rendered = lines.map(renderLine);

  return (
    <div className="space-y-3">
      {/* 工具栏 */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1.5">
          <Search className="h-4 w-4 text-muted-foreground" />
          <select
            value={level}
            onChange={(e) => setLevel(e.target.value)}
            className="h-8 rounded-md border border-input bg-background px-2 text-xs"
          >
            <option value="">全部级别</option>
            <option value="error">Error</option>
            <option value="warn">Warn</option>
            <option value="info">Info</option>
            <option value="debug">Debug</option>
          </select>
        </div>
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="关键词搜索..."
          className="h-8 w-48 text-xs"
          onKeyDown={(e) => e.key === "Enter" && refresh()}
        />
        <Button variant="outline" size="sm" onClick={refresh} disabled={loading} className="h-8">
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
          刷新
        </Button>
        <Button
          variant={streaming ? "default" : "outline"}
          size="sm"
          onClick={() => setStreaming((s) => !s)}
          className="h-8"
        >
          {streaming ? "● 实时" : "○ 已暂停"}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setAutoScroll((s) => !s)}
          className="h-8"
        >
          <ArrowDownToLine className={cn("h-3.5 w-3.5", autoScroll && "text-primary")} />
          自动滚动
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[180px_1fr] gap-3">
        {/* 文件列表 */}
        <div className="space-y-1">
          <div className="text-xs font-semibold text-muted-foreground px-1 mb-1">日志文件</div>
          {files.length === 0 ? (
            <div className="text-xs text-muted-foreground px-2 py-2">暂无日志</div>
          ) : (
            files.map((f) => (
              <button
                key={f.name}
                onClick={() => switchFile(f.name)}
                className={cn(
                  "w-full flex items-center gap-2 px-2 py-1.5 rounded text-left text-xs transition-colors",
                  currentFile === f.name
                    ? "bg-accent text-accent-foreground"
                    : "hover:bg-accent/50"
                )}
              >
                <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate font-mono">{f.name}</span>
              </button>
            ))
          )}
        </div>

        {/* 日志内容 */}
        <div
          ref={containerRef}
          className="rounded-md border border-border bg-zinc-950 p-3 h-[480px] overflow-auto font-mono text-xs leading-relaxed"
        >
          {rendered.length === 0 ? (
            <div className="text-zinc-500 text-center py-8">
              {loading ? "加载中…" : "暂无日志记录"}
            </div>
          ) : (
            rendered.map((l, i) => (
              <div key={i} className={cn("whitespace-pre-wrap break-all", l.color)}>
                {l.text}
              </div>
            ))
          )}
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        日志存储于 <code className="px-1 rounded bg-muted">~/.inkpress/logs/</code>
        ，单文件上限 20MB，最多保留 5 个历史文件。
      </p>
    </div>
  );
}
