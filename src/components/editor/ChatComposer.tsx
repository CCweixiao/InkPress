"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Send, Square, FileSearch } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { SlashMenu } from "./slash-commands";
import {
  BUILTIN_SLASH_COMMANDS,
  buildSkillCommands,
  filterSlashCommands,
  parseSlashCommand,
  slashQuery,
  type SlashCommand,
} from "./slash-commands";
import type { SkillCatalogItem } from "@/lib/ai/skills";

/** Composer 发送载荷。snippetRefs 与 forceSkillIds 互斥（@ 引用 vs /skill 命令）。 */
export type ComposerSendPayload = {
  text: string;
  snippetRefs: string[];
  forceSkillIds?: string[];
};

interface ChatComposerProps {
  /** 输入禁用（approval 锁定或非流式空输入场景）。 */
  disabled: boolean;
  /** 是否正在流式生成（控制发送/停止按钮切换）。 */
  streaming: boolean;
  placeholder: string;
  /** approval 锁定时额外的占位/样式提示（与 disabled 配合）。 */
  approvalBlocked?: boolean;
  inputHistory: string[];
  onSend: (payload: ComposerSendPayload) => void;
  onClearConversation: () => void | Promise<void>;
  onStop: () => void;
  children?: React.ReactNode;
}

/**
 * 隔离的 textarea：memo 化避免流式 chunk 引起的父级重渲染传递到输入框。
 * 父级用 ref 桥接 onKeyDown，使 handler 引用在渲染间稳定。（自 WritingAssistant L1542-1571 原样搬入）
 */
const ChatTextarea = memo(function ChatTextarea({
  value,
  disabled,
  placeholder,
  className,
  onChange,
  onKeyDown,
}: {
  value: string;
  disabled: boolean;
  placeholder: string;
  className: string;
  onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
}) {
  return (
    <textarea
      value={value}
      disabled={disabled}
      onChange={onChange}
      onKeyDown={onKeyDown}
      placeholder={placeholder}
      className={className}
    />
  );
});

function ChatComposerImpl({
  disabled,
  streaming,
  placeholder,
  approvalBlocked = false,
  inputHistory,
  onSend,
  onClearConversation,
  onStop,
  children,
}: ChatComposerProps) {
  const [input, setInput] = useState("");
  const historyIndex = useRef<number | null>(null);

  // ── 斜杠命令（自 WritingAssistant L1638-1673 原样搬入）──
  const [skills, setSkills] = useState<SkillCatalogItem[]>([]);
  const slashCommands = useMemo<SlashCommand[]>(
    () => [...BUILTIN_SLASH_COMMANDS, ...buildSkillCommands(skills)],
    [skills]
  );
  useEffect(() => {
    let active = true;
    fetch("/api/ai/skills")
      .then((response) => response.json())
      .then((data: { skills?: SkillCatalogItem[] }) => {
        if (active && Array.isArray(data.skills)) setSkills(data.skills);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  // 斜杠菜单：输入以 / 开头且尚未输入空格时打开，随输入过滤；Esc 临时关闭（再输入恢复）。
  const [slashIndex, setSlashIndex] = useState(0);
  const [slashForcedClosed, setSlashForcedClosed] = useState(false);
  const slashQ = slashQuery(input);
  const slashFiltered = useMemo(
    () =>
      slashQ && !slashForcedClosed
        ? filterSlashCommands(slashCommands, slashQ)
        : [],
    [slashQ, slashForcedClosed, slashCommands]
  );
  const slashOpen = slashFiltered.length > 0;
  useEffect(() => {
    setSlashIndex(0);
  }, [slashQ]);

  // 数据重载（refresh / 清空 / 发送）时复位历史索引，对齐原 WritingAssistant 行为。
  useEffect(() => {
    historyIndex.current = null;
  }, [inputHistory]);

  // 斜杠命令反馈
  const [slashNotice, setSlashNotice] = useState("");

  // ── 稳定 callback（自 WritingAssistant L1911-1925 原样搬入）──
  // --- 稳定 callback：避免流式重渲染把新函数引用传给 ChatTextarea ---
  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setInput(e.target.value);
      setSlashForcedClosed(false);
    },
    [] // setInput / setSlashForcedClosed 均为稳定 setState
  );
  // keydown 逻辑复杂、依赖多，用 ref 桥接保持引用稳定
  const chatKeydownRef = useRef<
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => void
  >(() => {});
  const stableChatKeydown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => chatKeydownRef.current(e),
    []
  );

  // ── slashSelect / submit（自 WritingAssistant L2027-2065 原样搬入，
  //      仅把 clearConversation/sendText 改为 props；sendText → onSend；
  //      busy/approvalBlocked 合并为入参 disabled）──
  /** 斜杠菜单选中：内置命令立即执行，Skill 插入 token + 空格待补参数。 */
  function slashSelect(command: SlashCommand) {
    setSlashForcedClosed(false);
    if (command.kind === "clear") {
      setInput("");
      void onClearConversation();
      return;
    }
    // skill：插入 /skillKey + 空格，保持焦点继续输入参数（空格后菜单自动关闭）
    setInput(`${command.token} `);
  }

  async function submit() {
    const text = input.trim();
    if (!text || disabled) return;
    const parsed = parseSlashCommand(text, slashCommands);
    if (parsed) {
      if (parsed.command.kind === "clear") {
        setInput("");
        setSlashForcedClosed(false);
        await onClearConversation();
        return;
      }
      // skill：发送完整 "/skillKey 文本" 作为可见消息（斜杠命令在用户气泡中可见），
      // 同时强制加载该 Skill；仅 /skill 无正文时提示并不发送。
      if (!parsed.args.trim()) {
        setSlashNotice(
          `请输入要发送的内容，例如：${parsed.command.token} 写一篇关于…`
        );
        window.setTimeout(() => setSlashNotice(""), 4000);
        return;
      }
      // Correction 2: 发送后重置历史索引，保持原 sendText 行为
      // （"发送后 ↑ 从最新一条开始"）。
      onSend({
        text,
        snippetRefs: [],
        forceSkillIds: parsed.command.skillKey
          ? [parsed.command.skillKey]
          : undefined,
      });
      historyIndex.current = null;
      setInput("");
      setSlashForcedClosed(false);
      return;
    }
    onSend({ text, snippetRefs: [] });
    historyIndex.current = null;
    setInput("");
    setSlashForcedClosed(false);
  }

  // ── keydown（自 WritingAssistant L2068-2128 原样搬入；
  //      busy → disabled；history 取自 props inputHistory）──
  // keydown ref：依赖较多，effect 中更新为最新闭包，stableChatKeydown 通过 ref 调用。
  useEffect(() => {
    chatKeydownRef.current = (event) => {
      if (slashOpen) {
        if (event.key === "ArrowDown") {
          event.preventDefault();
          setSlashIndex((i) => Math.min(slashFiltered.length - 1, i + 1));
          return;
        }
        if (event.key === "ArrowUp") {
          event.preventDefault();
          setSlashIndex((i) => Math.max(0, i - 1));
          return;
        }
        if (event.key === "Enter" || event.key === "Tab") {
          event.preventDefault();
          const cmd = slashFiltered[slashIndex] ?? slashFiltered[0];
          if (cmd) slashSelect(cmd);
          return;
        }
        if (event.key === "Escape") {
          event.preventDefault();
          setSlashForcedClosed(true);
          return;
        }
      }
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        void submit();
        return;
      }
      if (event.key === "ArrowUp" || event.key === "ArrowDown") {
        const el = event.currentTarget;
        const atFirstLine =
          el.value.slice(0, el.selectionStart).indexOf("\n") === -1;
        const atLastLine =
          el.value.slice(el.selectionStart).indexOf("\n") === -1;
        if (event.key === "ArrowUp" && atFirstLine && inputHistory.length) {
          event.preventDefault();
          const next =
            historyIndex.current === null
              ? inputHistory.length - 1
              : Math.max(0, historyIndex.current - 1);
          historyIndex.current = next;
          setInput(inputHistory[next]);
        } else if (
          event.key === "ArrowDown" &&
          atLastLine &&
          historyIndex.current !== null
        ) {
          event.preventDefault();
          if (historyIndex.current < inputHistory.length - 1) {
            historyIndex.current += 1;
            setInput(inputHistory[historyIndex.current]);
          } else {
            historyIndex.current = null;
            setInput("");
          }
        }
      }
    };
  });

  const busy = streaming;

  return (
    <div className="border-t p-3">
      <div className="relative rounded-xl border bg-background p-2 focus-within:ring-2 focus-within:ring-ring">
        {slashOpen && (
          <SlashMenu
            commands={slashFiltered}
            activeIndex={slashIndex}
            onSelect={slashSelect}
          />
        )}
        {slashNotice && (
          <div className="pointer-events-none absolute -top-2 left-2 flex -translate-y-full items-center gap-1.5 rounded-md border bg-background px-2 py-1 text-[11px] text-muted-foreground shadow-sm">
            {slashNotice}
          </div>
        )}
        {approvalBlocked && !busy && (
          <div className="pointer-events-none absolute -top-2 left-2 flex -translate-y-full items-center gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-[11px] text-amber-900 shadow-sm dark:border-amber-900 dark:bg-amber-950/60 dark:text-amber-100">
            <FileSearch className="h-3 w-3 shrink-0" />
            请先完成上方代码源授权，授权后将自动继续分析
          </div>
        )}
        <ChatTextarea
          value={input}
          disabled={approvalBlocked}
          onChange={handleInputChange}
          onKeyDown={stableChatKeydown}
          placeholder={placeholder}
          className={cn(
            "min-h-20 w-full resize-none bg-transparent px-1 text-xs outline-none",
            approvalBlocked && "cursor-not-allowed opacity-60"
          )}
        />
        {/* Correction 1: 底栏布局保持原 WritingAssistant——左侧为空占位（aria-hidden），
            右侧 shrink-0 容器承载 children（ModelSelector/TokenMeter）+ 发送/停止按钮。
            按钮（含 title / className）原样复制自 WritingAssistant.tsx。 */}
        <div className="flex items-center justify-between gap-1.5">
          <div className="flex min-h-8 flex-1 items-center gap-1.5" aria-hidden />
          <div className="flex shrink-0 items-center gap-1.5">
            {children}
            {busy ? (
              <Button
                size="icon"
                variant="outline"
                title="停止生成"
                className="h-8 w-8 shrink-0 border-red-300 text-red-600 hover:bg-red-50 hover:text-red-700 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950/50"
                onClick={onStop}
              >
                <Square className="h-3.5 w-3.5 fill-current" />
              </Button>
            ) : (
              <Button
                size="icon"
                className="h-8 w-8"
                disabled={!input.trim() || approvalBlocked}
                title={
                  approvalBlocked ? "请先完成代码源授权" : undefined
                }
                onClick={() => void submit()}
              >
                <Send className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export const ChatComposer = memo(ChatComposerImpl);
