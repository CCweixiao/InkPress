"use client";

import * as React from "react";
import * as CollapsiblePrimitive from "@radix-ui/react-collapsible";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export const Collapsible = CollapsiblePrimitive.Root;

/**
 * 折叠触发器：内部渲染一个带旋转箭头的按钮。
 * `data-[state=open]` 状态下箭头顺时针旋转 90°。
 */
export const CollapsibleTrigger = React.forwardRef<
  React.ElementRef<typeof CollapsiblePrimitive.CollapsibleTrigger>,
  React.ComponentPropsWithoutRef<typeof CollapsiblePrimitive.CollapsibleTrigger> & {
    /** 隐藏默认的 chevron 箭头（用于自定义触发内容）。 */
    hideIcon?: boolean;
  }
>(({ className, children, hideIcon, ...props }, ref) => (
  <CollapsiblePrimitive.CollapsibleTrigger
    ref={ref}
    className={cn(
      "group flex w-full items-center gap-1.5 text-left outline-none",
      className
    )}
    {...props}
  >
    {!hideIcon && (
      <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform duration-200 group-data-[state=open]:rotate-90" />
    )}
    {children}
  </CollapsiblePrimitive.CollapsibleTrigger>
));
CollapsibleTrigger.displayName = "CollapsibleTrigger";

/**
 * 折叠内容：用 grid-template-rows 0fr→1fr 过渡实现 height:auto 平滑展开，
 * 不依赖关键帧或固定高度。外层 grid 容器过渡，内层 overflow hidden。
 */
export const CollapsibleContent = React.forwardRef<
  React.ElementRef<typeof CollapsiblePrimitive.CollapsibleContent>,
  React.ComponentPropsWithoutRef<typeof CollapsiblePrimitive.CollapsibleContent>
>(({ className, children, ...props }, ref) => (
  <CollapsiblePrimitive.CollapsibleContent
    ref={ref}
    className={cn(
      "grid transition-[grid-template-rows] duration-200 ease-out",
      "data-[state=closed]:grid-rows-[0fr] data-[state=open]:grid-rows-[1fr]",
      className
    )}
    {...props}
  >
    <div className="overflow-hidden min-h-0">{children}</div>
  </CollapsiblePrimitive.CollapsibleContent>
));
CollapsibleContent.displayName = "CollapsibleContent";
