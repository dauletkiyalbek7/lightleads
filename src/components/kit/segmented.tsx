"use client";

import { motion } from "framer-motion";
import { useId, type ReactNode } from "react";
import { cn } from "@/lib/utils";

interface Option<T extends string> {
  value: T;
  label: ReactNode;
  icon?: ReactNode;
  ariaLabel?: string;
}

interface SegmentedProps<T extends string> {
  value: T;
  onChange: (value: T) => void;
  options: readonly Option<T>[];
  size?: "sm" | "md";
  /** Растянуть на всю ширину, сегменты равные. */
  full?: boolean;
  /** Прокрутка по горизонтали, если не помещается (табы настроек на телефоне). */
  scroll?: boolean;
  className?: string;
}

/** Табы с анимированным индикатором активного сегмента. */
export function Segmented<T extends string>({ value, onChange, options, size = "md", full, scroll, className }: SegmentedProps<T>) {
  const id = useId();
  return (
    <div
      role="tablist"
      className={cn(
        "inline-flex items-center gap-0.5 rounded-2xl bg-muted p-1",
        full && "flex w-full",
        scroll && "no-scrollbar max-w-full overflow-x-auto",
        className,
      )}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="tab"
            aria-selected={active}
            aria-label={opt.ariaLabel}
            onClick={() => onChange(opt.value)}
            className={cn(
              "relative inline-flex shrink-0 items-center justify-center gap-1.5 rounded-xl px-3.5 text-sm font-medium whitespace-nowrap outline-none transition-colors focus-visible:ring-4 focus-visible:ring-brand/25 [&_svg]:size-4",
              size === "md" ? "h-10 before:-inset-y-0.5 md:h-9" : "h-9 px-3 text-[13px] before:-inset-y-1 md:h-8",
              "before:absolute before:inset-x-0 before:content-['']",
              full && "flex-1",
              active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {active && (
              <motion.span
                layoutId={`seg-${id}`}
                className="absolute inset-0 rounded-xl bg-card shadow-[0_1px_2px_rgba(16,24,40,0.06),0_4px_12px_rgba(109,91,255,0.10)]"
                transition={{ type: "spring", stiffness: 480, damping: 36 }}
              />
            )}
            <span className="relative z-10 inline-flex items-center gap-1.5">
              {opt.icon}
              {opt.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
