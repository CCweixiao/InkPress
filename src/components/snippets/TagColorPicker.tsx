"use client";

import { Check } from "lucide-react";
import { TAG_COLOR_NAMES, getTagColorClasses } from "@/lib/snippets/tag-colors";
import { cn } from "@/lib/utils";

interface TagColorPickerProps {
  value: string | null;
  onSelect: (color: string | null) => void;
}

/** 8 色色板 + 清除。作为 PopoverContent 内嵌使用。 */
export function TagColorPicker({ value, onSelect }: TagColorPickerProps) {
  return (
    <div className="w-44">
      <div className="grid grid-cols-4 gap-2">
        {TAG_COLOR_NAMES.map((c) => {
          const cls = getTagColorClasses(c);
          const selected = value === c;
          return (
            <button
              key={c}
              type="button"
              onClick={() => onSelect(c)}
              aria-label={`颜色 ${c}`}
              title={c}
              className={cn(
                "h-7 w-7 rounded-full flex items-center justify-center transition-transform hover:scale-110",
                cls.dot,
                selected &&
                  "ring-2 ring-offset-2 ring-offset-background ring-foreground/50"
              )}
            >
              {selected && <Check className="h-3.5 w-3.5 text-white" />}
            </button>
          );
        })}
      </div>
      <button
        type="button"
        onClick={() => onSelect(null)}
        className="mt-2 w-full text-xs text-muted-foreground hover:text-foreground text-center"
      >
        清除颜色
      </button>
    </div>
  );
}
