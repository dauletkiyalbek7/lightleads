"use client";

import { motion } from "framer-motion";
import { ChevronDown } from "lucide-react";
import { EASE_OUT } from "@/components/kit/motion";
import { t } from "@/i18n";
import { formatInt, formatPercent } from "@/lib/format";
import type { Totals } from "@/lib/metrics";

/**
 * Воронка показы → клики → лиды → продажи.
 * Ширина ступеней условная (значения отличаются на порядки), поэтому на каждой ступени
 * подписано число, а между ступенями — конверсия шага. Один оттенок, от светлого к тёмному.
 */
const STEPS = [
  { key: "impressions", width: 100, fill: "color-mix(in oklab, var(--brand) 26%, white)", dark: false },
  { key: "clicks", width: 80, fill: "color-mix(in oklab, var(--brand) 50%, white)", dark: false },
  { key: "leads", width: 60, fill: "color-mix(in oklab, var(--brand) 78%, white)", dark: true },
  { key: "sales", width: 42, fill: "var(--brand)", dark: true },
] as const;

export function Funnel({ totals }: { totals: Totals }) {
  return (
    <div className="flex flex-col items-center">
      {STEPS.map((step, i) => {
        const value = totals[step.key];
        const prev = i > 0 ? totals[STEPS[i - 1].key] : 0;
        const conversion = i > 0 && prev > 0 ? value / prev : null;
        return (
          <div key={step.key} className="flex w-full flex-col items-center">
            {i > 0 && (
              <div className="num flex h-8 items-center gap-1 text-xs text-muted-foreground" title={t.dashboard.funnelConv}>
                <ChevronDown className="size-3.5 text-subtle" />
                <span className="font-semibold text-foreground">{formatPercent(conversion, conversion !== null && conversion < 0.1 ? 2 : 1)}</span>
              </div>
            )}
            <motion.div
              initial={{ width: "20%", opacity: 0 }}
              animate={{ width: `${step.width}%`, opacity: 1 }}
              transition={{ duration: 0.7, ease: EASE_OUT, delay: 0.1 + i * 0.08 }}
              className="flex h-14 min-w-36 items-center justify-between gap-3 rounded-2xl px-4"
              style={{ background: step.fill, color: step.dark ? "#fff" : "#101828" }}
            >
              <span className="truncate text-[13px] font-medium">{t.dashboard.funnelSteps[step.key]}</span>
              <span className="num font-display text-sm font-semibold">{formatInt(value)}</span>
            </motion.div>
          </div>
        );
      })}
    </div>
  );
}
