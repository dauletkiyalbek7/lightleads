"use client";

import { ArrowUpRight, EyeOff, ThumbsDown, ThumbsUp } from "lucide-react";
import Link from "next/link";
import { PriorityPill } from "@/components/kit/pills";
import { Surface } from "@/components/kit/surface";
import { t } from "@/i18n";
import type { Advice } from "@/lib/advice";
import { cn } from "@/lib/utils";

export type Feedback = "useful" | "not_useful";

interface AdviceCardProps {
  advice: Advice;
  feedback?: Feedback;
  onFeedback?: (value: Feedback) => void;
  onHide?: () => void;
  /** Компактный вид без тени для дашборда: заголовок и «что сделать». */
  flat?: boolean;
}

const ACTION_BTN =
  "inline-flex min-h-11 items-center gap-1.5 rounded-xl px-3 text-[13px] font-medium outline-none transition focus-visible:ring-4 focus-visible:ring-brand/25";

/** Карточка совета: что случилось, почему это важно, что сделать. */
export function AdviceCard({ advice, feedback, onFeedback, onHide, flat }: AdviceCardProps) {
  const { signal } = advice;
  return (
    <Surface className={cn("flex h-full flex-col p-5 md:p-6", flat && "bg-muted/40 p-4 shadow-none md:p-5")}>
      <div className="flex items-start justify-between gap-3">
        <PriorityPill priority={signal.priority} />
        <Link
          href={signal.href}
          className="inline-flex min-h-11 items-center gap-1 rounded-xl px-2 text-[13px] font-medium text-brand outline-none hover:bg-brand-soft focus-visible:ring-4 focus-visible:ring-brand/25"
        >
          {t.ai.open}
          <ArrowUpRight className="size-4" />
        </Link>
      </div>
      <h3 className="mt-3 text-base leading-snug font-semibold">{advice.title}</h3>

      <dl className="mt-4 flex-1 space-y-3 text-sm leading-relaxed">
        {(flat
          ? []
          : ([
              [t.ai.what, advice.what],
              [t.ai.why, advice.why],
            ] as const)
        ).map(([term, text]) => (
          <div key={term}>
            <dt className="text-xs font-medium tracking-wide text-subtle uppercase">{term}</dt>
            <dd className="mt-0.5 text-muted-foreground">{text}</dd>
          </div>
        ))}
        <div className="rounded-2xl bg-brand-soft/70 p-3.5">
          <dt className="text-xs font-medium tracking-wide text-accent-foreground uppercase">{t.ai.action}</dt>
          <dd className="mt-0.5 text-foreground">{advice.action}</dd>
        </div>
      </dl>

      {onFeedback && (
        <div className="mt-4 flex flex-wrap items-center gap-1 border-t border-border pt-3">
          <button
            type="button"
            onClick={() => onFeedback("useful")}
            aria-pressed={feedback === "useful"}
            className={cn(ACTION_BTN, feedback === "useful" ? "bg-success/12 text-[#067647]" : "text-muted-foreground hover:bg-muted")}
          >
            <ThumbsUp className="size-4" />
            {t.ai.useful}
          </button>
          <button
            type="button"
            onClick={() => onFeedback("not_useful")}
            aria-pressed={feedback === "not_useful"}
            className={cn(ACTION_BTN, feedback === "not_useful" ? "bg-danger/10 text-[#B42318]" : "text-muted-foreground hover:bg-muted")}
          >
            <ThumbsDown className="size-4" />
            {t.ai.notUseful}
          </button>
          <button type="button" onClick={onHide} className={cn(ACTION_BTN, "ml-auto text-muted-foreground hover:bg-muted")}>
            <EyeOff className="size-4" />
            {t.ai.hide}
          </button>
        </div>
      )}
    </Surface>
  );
}
