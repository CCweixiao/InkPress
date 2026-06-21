"use client";

import { useState, useCallback } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export type ConfirmOptions = {
  title?: string;
  description?: string;
  confirmText?: string;
  cancelText?: string;
  /** 确认按钮样式：destructive 用于删除等危险操作 */
  variant?: "destructive" | "default";
};

/**
 * 可复用的框架级确认弹窗，替代 window.confirm。
 *
 * 用法：
 *   const confirm = useConfirm();
 *   const ok = await confirm({ title: "彻底删除？", variant: "destructive" });
 *   if (!ok) return;
 *   // 执行删除
 */
export function useConfirm() {
  const [state, setState] = useState<{
    open: boolean;
    options: ConfirmOptions;
    resolve?: (v: boolean) => void;
    loading: boolean;
  }>({ open: false, options: {}, loading: false });

  const confirm = useCallback((options: ConfirmOptions = {}) => {
    return new Promise<boolean>((resolve) => {
      setState({ open: true, options, resolve, loading: false });
    });
  }, []);

  const close = useCallback(
    (result: boolean) => {
      setState((cur) => {
        cur.resolve?.(result);
        return { open: false, options: cur.options, loading: false };
      });
    },
    []
  );

  const setLoading = useCallback((loading: boolean) => {
    setState((cur) => ({ ...cur, loading }));
  }, []);

  const dialog = (
    <Dialog
      open={state.open}
      onOpenChange={(v) => {
        if (!v && !state.loading) close(false);
      }}
    >
      <DialogContent className="max-w-sm">
        <DialogHeader>
          {state.options.variant === "destructive" && (
            <div className="flex items-center gap-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-red-50">
                <AlertTriangle className="h-5 w-5 text-red-600" />
              </div>
              <DialogTitle>{state.options.title ?? "请确认"}</DialogTitle>
            </div>
          )}
          {state.options.variant !== "destructive" && (
            <DialogTitle>{state.options.title ?? "请确认"}</DialogTitle>
          )}
          {state.options.description && (
            <DialogDescription>{state.options.description}</DialogDescription>
          )}
        </DialogHeader>
        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            variant="outline"
            onClick={() => close(false)}
            disabled={state.loading}
          >
            {state.options.cancelText ?? "取消"}
          </Button>
          <Button
            variant={state.options.variant === "destructive" ? "destructive" : "default"}
            disabled={state.loading}
            onClick={() => close(true)}
          >
            {state.loading && <Loader2 className="h-4 w-4 animate-spin" />}
            {state.options.confirmText ?? "确认"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  return { confirm, dialog, setLoading };
}
