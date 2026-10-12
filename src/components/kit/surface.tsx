import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Белая карточка на светлом фоне: скругление 20px, мягкая цветная тень. */
export function Surface({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("rounded-[20px] border border-border bg-card shadow-card", className)} {...props} />;
}

interface SectionProps {
  title: ReactNode;
  hint?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}

export function Section({ title, hint, action, children, className, bodyClassName }: SectionProps) {
  return (
    <Surface className={cn("flex flex-col", className)}>
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2 px-5 pt-5 md:px-6 md:pt-6">
        <div className="min-w-0">
          <h2 className="font-display text-[15px] leading-tight font-semibold tracking-tight">{title}</h2>
          {hint && <div className="mt-1 text-sm text-muted-foreground">{hint}</div>}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      <div className={cn("flex-1 p-5 md:p-6", bodyClassName)}>{children}</div>
    </Surface>
  );
}

const TONES = {
  brand: "bg-brand-soft text-brand",
  coral: "bg-coral/12 text-coral",
  /** Цвет серии «Расход» — совпадает с линией на графике в любой теме */
  spend: "bg-series-spend/12 text-series-spend",
  sun: "bg-sun/18 text-[#B26A00]",
  success: "bg-success/12 text-success",
  blue: "bg-brand-2/12 text-brand-2",
  danger: "bg-danger/10 text-danger",
  muted: "bg-muted text-muted-foreground",
} as const;

export type Tone = keyof typeof TONES;

/** Иконка в цветной «таблетке». */
export function IconPill({ tone = "brand", className, children }: { tone?: Tone; className?: string; children: ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex size-10 shrink-0 items-center justify-center rounded-[14px] [&_svg]:size-5",
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
