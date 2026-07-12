"use client";

import {
  forwardRef,
  memo,
  useCallback,
  useImperativeHandle,
  useRef,
} from "react";
import { cn } from "@/lib/utils";
import {
  composerDocumentToPlainText,
  normalizeComposerDocument,
  type ComposerDocument,
} from "@/lib/snippets/injection-review";
import type { SnippetSearchItem } from "./at-commands";
import {
  shouldNotifyInputOnKeyUp,
  splitLeadingSlashToken,
} from "@/lib/ui/menu-navigation";

export type StructuredChatInputHandle = {
  getDocument: () => ComposerDocument;
  setDocument: (document: ComposerDocument) => void;
  insertCommand: (command: { token: string; label: string }) => void;
  insertSnippet: (item: SnippetSearchItem) => void;
  focus: () => void;
};

export type StructuredMentionQuery = { query: string };

function appendText(root: HTMLElement, text: string) {
  const lines = text.split("\n");
  lines.forEach((line, index) => {
    if (line) root.appendChild(document.createTextNode(line));
    if (index < lines.length - 1) root.appendChild(document.createElement("br"));
  });
}

function createSnippetNode(id: string, title: string) {
  const chip = document.createElement("span");
  chip.contentEditable = "false";
  chip.dataset.snippetId = id;
  chip.dataset.snippetTitle = title;
  chip.className =
    "mx-0.5 inline-flex max-w-[min(18rem,75%)] select-none items-center gap-1 rounded-full border border-primary/25 bg-primary/10 px-2 py-0.5 align-middle text-xs font-medium text-primary dark:border-blue-300/15 dark:bg-blue-300/10 dark:text-blue-200";

  const icon = document.createElement("span");
  icon.setAttribute("aria-hidden", "true");
  icon.className = "shrink-0 text-[10px]";
  icon.textContent = "✦";
  chip.appendChild(icon);

  const label = document.createElement("span");
  label.className = "min-w-0 truncate";
  label.textContent = title;
  chip.appendChild(label);

  const remove = document.createElement("span");
  remove.dataset.removeSnippet = "true";
  remove.setAttribute("role", "button");
  remove.setAttribute("aria-label", `移除灵感：${title}`);
  remove.className =
    "ml-0.5 inline-flex h-4 w-4 shrink-0 cursor-pointer items-center justify-center rounded-full text-sm leading-none hover:bg-primary/15";
  remove.textContent = "×";
  chip.appendChild(remove);
  return chip;
}

function createCommandNode(token: string, label: string) {
  const chip = document.createElement("span");
  chip.contentEditable = "false";
  chip.dataset.commandToken = token;
  chip.dataset.commandLabel = label;
  chip.title = token;
  chip.className =
    "mx-0.5 inline-flex max-w-[min(18rem,75%)] select-none items-center gap-1.5 rounded-md border border-primary/20 bg-primary/8 px-2 py-0.5 align-middle text-xs font-medium text-primary shadow-sm";

  const icon = document.createElement("span");
  icon.setAttribute("aria-hidden", "true");
  icon.className =
    "flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border border-primary/25 bg-background text-[9px] leading-none";
  icon.textContent = "S";
  chip.appendChild(icon);

  const text = document.createElement("span");
  text.className = "min-w-0 truncate";
  text.textContent = label || token;
  chip.appendChild(text);
  return chip;
}

function readDocument(root: HTMLElement): ComposerDocument {
  const output: ComposerDocument = [];
  const pushText = (text: string) => {
    if (!text) return;
    const previous = output[output.length - 1];
    if (previous?.type === "text") previous.text += text;
    else output.push({ type: "text", text });
  };
  const visit = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      pushText(node.textContent ?? "");
      return;
    }
    if (!(node instanceof HTMLElement)) return;
    if (node.dataset.commandToken) {
      pushText(node.dataset.commandToken);
      return;
    }
    if (node.dataset.snippetId) {
      output.push({
        type: "snippet",
        id: node.dataset.snippetId,
        title: node.dataset.snippetTitle || "未命名灵感",
      });
      return;
    }
    if (node.tagName === "BR") {
      pushText("\n");
      return;
    }
    const block = node !== root && (node.tagName === "DIV" || node.tagName === "P");
    Array.from(node.childNodes).forEach(visit);
    if (block) pushText("\n");
  };
  Array.from(root.childNodes).forEach(visit);
  return normalizeComposerDocument(output);
}

function placeCaretAtEnd(root: HTMLElement) {
  const selection = window.getSelection();
  if (!selection) return;
  const range = document.createRange();
  range.selectNodeContents(root);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
}

export const StructuredChatInput = memo(forwardRef<
  StructuredChatInputHandle,
  {
    disabled?: boolean;
    placeholder: string;
    className?: string;
    onDocumentChange: (
      document: ComposerDocument,
      plainText: string,
      mention: StructuredMentionQuery | null
    ) => void;
    onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => void;
    onCompositionStart: () => void;
    onCompositionEnd: () => void;
  }
>(function StructuredChatInput(
  {
    disabled,
    placeholder,
    className,
    onDocumentChange,
    onKeyDown,
    onCompositionStart,
    onCompositionEnd,
  },
  forwardedRef
) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const mentionRangeRef = useRef<Range | null>(null);

  const notify = useCallback(() => {
    const root = rootRef.current;
    if (!root) return;
    const documentValue = readDocument(root);
    let mention: StructuredMentionQuery | null = null;
    mentionRangeRef.current = null;
    const selection = window.getSelection();
    if (
      selection?.rangeCount &&
      selection.isCollapsed &&
      root.contains(selection.anchorNode) &&
      selection.anchorNode?.nodeType === Node.TEXT_NODE
    ) {
      const node = selection.anchorNode;
      const before = (node.textContent ?? "").slice(0, selection.anchorOffset);
      const match = before.match(/@([^\s@]*)$/);
      if (match) {
        const range = document.createRange();
        range.setStart(node, selection.anchorOffset - match[0].length);
        range.setEnd(node, selection.anchorOffset);
        mentionRangeRef.current = range;
        mention = { query: match[1] };
      }
    }
    onDocumentChange(
      documentValue,
      composerDocumentToPlainText(documentValue),
      mention
    );
  }, [onDocumentChange]);

  const renderDocument = useCallback(
    (documentValue: ComposerDocument) => {
      const root = rootRef.current;
      if (!root) return;
      root.replaceChildren();
      for (const segment of normalizeComposerDocument(documentValue)) {
        if (segment.type === "text") {
          const command =
            root.childNodes.length === 0
              ? splitLeadingSlashToken(segment.text)
              : null;
          if (command) {
            root.appendChild(createCommandNode(command.token, command.token));
            appendText(root, command.rest);
          } else {
            appendText(root, segment.text);
          }
        } else {
          root.appendChild(createSnippetNode(segment.id, segment.title));
        }
      }
      placeCaretAtEnd(root);
      notify();
    },
    [notify]
  );

  useImperativeHandle(
    forwardedRef,
    () => ({
      getDocument: () =>
        rootRef.current ? readDocument(rootRef.current) : [],
      setDocument: renderDocument,
      insertCommand: ({ token, label }) => {
        const root = rootRef.current;
        if (!root) return;
        root.replaceChildren(
          createCommandNode(token, label),
          document.createTextNode(" ")
        );
        placeCaretAtEnd(root);
        notify();
        root.focus();
      },
      insertSnippet: (item) => {
        const root = rootRef.current;
        if (!root) return;
        const existing = root.querySelector(
          `[data-snippet-id="${CSS.escape(item.id)}"]`
        );
        if (existing) return;
        const title = (item.title || item.summary || "未命名灵感").trim();
        const chip = createSnippetNode(item.id, title);
        const range = mentionRangeRef.current;
        if (range && root.contains(range.commonAncestorContainer)) {
          range.deleteContents();
          range.insertNode(chip);
          const spacer = document.createTextNode(" ");
          chip.after(spacer);
          range.setStartAfter(spacer);
          range.collapse(true);
          const selection = window.getSelection();
          selection?.removeAllRanges();
          selection?.addRange(range);
        } else {
          root.appendChild(chip);
          root.appendChild(document.createTextNode(" "));
          placeCaretAtEnd(root);
        }
        mentionRangeRef.current = null;
        notify();
        root.focus();
      },
      focus: () => rootRef.current?.focus(),
    }),
    [notify, renderDocument]
  );

  return (
    <div
      ref={rootRef}
      role="textbox"
      aria-multiline="true"
      aria-label={placeholder}
      data-placeholder={placeholder}
      contentEditable={!disabled}
      suppressContentEditableWarning
      className={cn(
        "min-h-20 w-full whitespace-pre-wrap break-words bg-transparent px-1 text-xs leading-6 outline-none [overflow-wrap:anywhere] empty:before:pointer-events-none empty:before:text-muted-foreground empty:before:content-[attr(data-placeholder)]",
        disabled && "cursor-not-allowed opacity-60",
        className
      )}
      onInput={notify}
      onKeyUp={(event) => {
        if (shouldNotifyInputOnKeyUp(event.key)) notify();
      }}
      onKeyDown={onKeyDown}
      onCompositionStart={onCompositionStart}
      onCompositionEnd={() => {
        onCompositionEnd();
        notify();
      }}
      onPaste={(event) => {
        event.preventDefault();
        document.execCommand(
          "insertText",
          false,
          event.clipboardData.getData("text/plain")
        );
      }}
      onClick={(event) => {
        const target = event.target as HTMLElement;
        if (!target.closest("[data-remove-snippet]")) return;
        event.preventDefault();
        target.closest("[data-snippet-id]")?.remove();
        notify();
        rootRef.current?.focus();
      }}
    />
  );
}));
