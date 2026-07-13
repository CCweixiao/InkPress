"use client";

import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Send, Square, FileSearch, Loader2 } from "lucide-react";
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
import {
  filterSnippets,
  type SnippetSearchItem,
} from "./at-commands";
import { SnippetMentionPopover } from "./SnippetMentionPopover";
import type { InlineSnippetRef } from "@/lib/ai/snippet-serialize";
import type { SkillCatalogItem } from "@/lib/ai/skills";
import {
  StructuredChatInput,
  type StructuredChatInputHandle,
  type StructuredMentionQuery,
} from "./StructuredChatInput";
import {
  normalizeComposerDocument,
  type ComposerDocument,
  type ComposerSnippetSegment,
} from "@/lib/snippets/injection-review";
import { SubmissionGuard } from "@/lib/ai/submission-guard";
import {
  mentionMenuKeyAction,
  moveMenuIndex,
} from "@/lib/ui/menu-navigation";

/** Composer 发送载荷。snippetRefs 与 forceSkillIds 互斥（@ 引用 vs /skill 命令）。 */
export type ComposerSendPayload = {
  text: string;
  composer: ComposerDocument;
  snippetRefs: InlineSnippetRef[];
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
  inputHistory: ComposerDocument[];
  restoreDraft?: { key: string; document: ComposerDocument } | null;
  onDraftRestored?: () => void;
  onDraftChange?: (document: ComposerDocument) => void;
  onDraftClear?: () => void;
  onSend: (payload: ComposerSendPayload) => void | boolean | Promise<void | boolean>;
  onClearConversation: () => void | Promise<void>;
  onStop: () => void;
  children?: React.ReactNode;
}

function ChatComposerImpl({
  disabled,
  streaming,
  placeholder,
  approvalBlocked = false,
  inputHistory,
  restoreDraft,
  onDraftRestored,
  onDraftChange,
  onDraftClear,
  onSend,
  onClearConversation,
  onStop,
  children,
}: ChatComposerProps) {
  const [input, setInput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const submissionGuardRef = useRef(new SubmissionGuard());
  const historyIndex = useRef<number | null>(null);
  const draftBeforeHistoryRef = useRef<ComposerDocument | null>(null);
  const suppressDraftChangeRef = useRef(false);

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

  // ── @ 灵感引用 ──
  const [atItems, setAtItems] = useState<SnippetSearchItem[]>([]);
  const [atActiveIndex, setAtActiveIndex] = useState(0);
  const [atLoading, setAtLoading] = useState(false);
  const [atError, setAtError] = useState(false);
  const [isComposing, setIsComposing] = useState(false);
  const [atQueryResult, setAtQueryResult] =
    useState<StructuredMentionQuery | null>(null);
  const inputRef = useRef<StructuredChatInputHandle | null>(null);
  const atOpen = atQueryResult !== null;

  const handleInputChange = useCallback(
    (
      _document: ComposerDocument,
      plainText: string,
      mention: StructuredMentionQuery | null
    ) => {
      setInput(plainText);
      setSlashForcedClosed(false);
      setAtQueryResult(isComposing ? null : mention);
      if (suppressDraftChangeRef.current) {
        suppressDraftChangeRef.current = false;
        return;
      }
      if (historyIndex.current !== null) {
        historyIndex.current = null;
        draftBeforeHistoryRef.current = null;
      }
      onDraftChange?.(_document);
    },
    [isComposing, onDraftChange]
  );
  // 流式 token/用量更新会重渲染 Composer 底栏；组合输入回调保持稳定，
  // 让 StructuredChatInput 的 memo 边界不触碰 contenteditable DOM。
  const handleCompositionStart = useCallback(() => setIsComposing(true), []);
  const handleCompositionEnd = useCallback(() => setIsComposing(false), []);

  useEffect(() => {
    setAtActiveIndex(0);
  }, [atQueryResult?.query]);

  useEffect(() => {
    if (!restoreDraft) return;
    suppressDraftChangeRef.current = true;
    inputRef.current?.setDocument(restoreDraft.document);
    historyIndex.current = null;
    draftBeforeHistoryRef.current = null;
    const frame = requestAnimationFrame(() => onDraftRestored?.());
    return () => cancelAnimationFrame(frame);
  }, [restoreDraft, onDraftRestored]);

  const chatKeydownRef = useRef<
    (e: React.KeyboardEvent<HTMLDivElement>) => void
  >(() => {});
  const stableChatKeydown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => chatKeydownRef.current(e),
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
      historyIndex.current = null;
      draftBeforeHistoryRef.current = null;
      inputRef.current?.setDocument([]);
      void onClearConversation();
      return;
    }
    // skill：插入 /skillKey + 空格，保持焦点继续输入参数（空格后菜单自动关闭）
    inputRef.current?.insertCommand({
      token: command.token,
      label: command.label,
    });
  }

  /** @ 选中：把原子灵感标签插入当前光标位置。 */
  function selectSnippet(item: SnippetSearchItem) {
    inputRef.current?.insertSnippet(item);
    setAtQueryResult(null);
    setAtItems([]);
  }

  async function submit() {
    if (!submissionGuardRef.current.acquire()) return;
    setSubmitting(true);
    try {
    const text = input.trim();
    if (!text || disabled) return;
    const composer = inputRef.current?.getDocument() ?? [];
    const snippetRefs = composer
      .filter(
        (segment): segment is ComposerSnippetSegment =>
          segment.type === "snippet"
      )
      .map((segment) => ({
        id: segment.id,
        token: `[灵感：${segment.title}]`,
      }));
    const parsed = parseSlashCommand(text, slashCommands);
    if (parsed) {
      if (parsed.command.kind === "clear") {
        setInput("");
        historyIndex.current = null;
        draftBeforeHistoryRef.current = null;
        inputRef.current?.setDocument([]);
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
      const sent = await onSend({
        text,
        composer,
        snippetRefs: [],
        forceSkillIds: parsed.command.skillKey
          ? [parsed.command.skillKey]
          : undefined,
      });
      if (sent === false) return;
      historyIndex.current = null;
      draftBeforeHistoryRef.current = null;
      setInput("");
      inputRef.current?.setDocument([]);
      onDraftClear?.();
      setSlashForcedClosed(false);
      return;
    }
    const sent = await onSend({ text, composer, snippetRefs });
    if (sent === false) return;
    historyIndex.current = null;
    draftBeforeHistoryRef.current = null;
    setInput("");
    inputRef.current?.setDocument([]);
    onDraftClear?.();
    setSlashForcedClosed(false);
    } finally {
      submissionGuardRef.current.release();
      setSubmitting(false);
    }
  }

  // ── keydown（自 WritingAssistant L2068-2128 原样搬入；
  //      busy → disabled；history 取自 props inputHistory）──
  // keydown ref：依赖较多，effect 中更新为最新闭包，stableChatKeydown 通过 ref 调用。
  useEffect(() => {
    chatKeydownRef.current = (event) => {
      if (slashOpen) {
        if (event.key === "ArrowDown") {
          event.preventDefault();
          setSlashIndex((i) => moveMenuIndex(i, "next", slashFiltered.length));
          return;
        }
        if (event.key === "ArrowUp") {
          event.preventDefault();
          setSlashIndex((i) =>
            moveMenuIndex(i, "previous", slashFiltered.length)
          );
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
      } else if (atOpen) {
        const action = mentionMenuKeyAction(event.key, atLoading);
        if (action) event.preventDefault();
        if (action === "next") {
          setAtActiveIndex((i) => moveMenuIndex(i, "next", atItems.length));
          return;
        }
        if (action === "previous") {
          setAtActiveIndex((i) =>
            moveMenuIndex(i, "previous", atItems.length)
          );
          return;
        }
        if (action === "select") {
          const item = atItems[atActiveIndex] ?? atItems[0];
          if (item) selectSnippet(item);
          return;
        }
        if (action === "close") {
          setAtQueryResult(null);
          setAtItems([]);
          return;
        }
        if (action === "hold") return;
      }
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        void submit();
        return;
      }
      if (event.key === "ArrowUp" || event.key === "ArrowDown") {
        const el = event.currentTarget;
        const selection = window.getSelection();
        const beforeRange = document.createRange();
        beforeRange.selectNodeContents(el);
        if (selection?.anchorNode && el.contains(selection.anchorNode)) {
          beforeRange.setEnd(selection.anchorNode, selection.anchorOffset);
        }
        const before = beforeRange.toString();
        const full = el.innerText;
        const atFirstLine =
          before.indexOf("\n") === -1;
        const atLastLine = full.slice(before.length).indexOf("\n") === -1;
        if (event.key === "ArrowUp" && atFirstLine && inputHistory.length) {
          event.preventDefault();
          if (historyIndex.current === null) {
            draftBeforeHistoryRef.current = normalizeComposerDocument(
              inputRef.current?.getDocument() ?? []
            );
          }
          const next =
            historyIndex.current === null
              ? inputHistory.length - 1
              : Math.max(0, historyIndex.current - 1);
          historyIndex.current = next;
          suppressDraftChangeRef.current = true;
          inputRef.current?.setDocument(inputHistory[next]);
        } else if (
          event.key === "ArrowDown" &&
          atLastLine &&
          historyIndex.current !== null
        ) {
          event.preventDefault();
          if (historyIndex.current < inputHistory.length - 1) {
            historyIndex.current += 1;
            suppressDraftChangeRef.current = true;
            inputRef.current?.setDocument(inputHistory[historyIndex.current]);
          } else {
            historyIndex.current = null;
            const draft = draftBeforeHistoryRef.current ?? [];
            draftBeforeHistoryRef.current = null;
            suppressDraftChangeRef.current = true;
            inputRef.current?.setDocument(draft);
          }
        }
      }
    };
  });

  // @ 面板检索：atQueryResult 变化时 debounce 150ms fetch /api/snippets/search
  useEffect(() => {
    if (!atQueryResult) {
      setAtItems([]);
      setAtError(false);
      return;
    }
    const q = atQueryResult.query;
    setAtLoading(true);
    setAtError(false);
    const timer = window.setTimeout(async () => {
      try {
        const url = `/api/snippets/search?limit=20${q ? `&q=${encodeURIComponent(q)}` : ""}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error("search failed");
        const data = (await res.json()) as { items: SnippetSearchItem[] };
        setAtItems(filterSnippets(data.items ?? [], q));
      } catch {
        setAtError(true);
      } finally {
        setAtLoading(false);
      }
    }, 150);
    return () => window.clearTimeout(timer);
  }, [atQueryResult]);

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
        {atOpen && (
          <SnippetMentionPopover
            items={atItems}
            activeIndex={atActiveIndex}
            loading={atLoading}
            error={atError}
            onRetry={() => setAtQueryResult((r) => (r ? { ...r } : r))}
            onSelect={selectSnippet}
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
        <StructuredChatInput
          ref={inputRef}
          disabled={disabled || submitting}
          onDocumentChange={handleInputChange}
          onKeyDown={stableChatKeydown}
          onCompositionStart={handleCompositionStart}
          onCompositionEnd={handleCompositionEnd}
          placeholder={placeholder}
          className={cn(
            "min-h-20 w-full resize-none bg-transparent px-1 text-xs outline-none",
            (disabled || submitting) && "cursor-not-allowed opacity-60"
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
                disabled={!input.trim() || disabled || submitting}
                title={
                  approvalBlocked ? "请先完成代码源授权" : undefined
                }
                onClick={() => void submit()}
              >
                {submitting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export const ChatComposer = memo(ChatComposerImpl);
