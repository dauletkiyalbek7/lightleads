"use client";

import { motion } from "framer-motion";
import { useCallback, type ReactNode } from "react";
import { Sparkline } from "@/components/charts/sparkline";
import { CountUp } from "@/components/kit/motion";
import { RateTip, SecondaryMoney } from "@/components/kit/money";
import { Delta } from "@/components/kit/pills";
import { IconPill, Surface, type Tone } from "@/components/kit/surface";
import { otherCurrency } from "@/lib/currency";
import { formatInt, formatMoney, formatPercent } from "@/lib/format";
import { useApp } from "@/lib/store";
import type { Dual } from "@/lib/types";
import { cn } from "@/lib/utils";

interface KpiCardProps {
  label: string;
  icon: ReactNode;
  tone: Tone;
  /** Цвет спарклайна */
  color: string;
  /** Денежная метрика (в двух валютах) либо число / доля. */
  money?: Dual;
  count?: number;
  percent?: number | null;
  delta: number | null;
  good?: "up" | "down" | "none";
  spark: number[];
  hint?: string;
  className?: string;
}

/** KPI-карточка: анимированный счётчик, дельта к прошлому периоду и сумма во второй валюте. */
export function KpiCard({ label, icon, tone, color, money, count, percent, delta, good = "up", spark, hint, className }: KpiCardProps) {
  const { currency, compare } = useApp();
  const second = otherCurrency(currency);

  const format = useCallback(
    (n: number) => {
      if (money) return formatMoney(n, currency, { round: Math.abs(n) >= 10_000 });
      if (percent !== undefined) return formatPercent(n, 0);
      return formatInt(Math.round(n));
    },
    [money, percent, currency],
  );
  const value = money ? money[currency] : percent !== undefined ? (percent ?? 0) : (count ?? 0);

  return (
    <motion.div whileHover={{ y: -3 }} transition={{ type: "spring", stiffness: 380, damping: 26 }} className={cn("h-full", className)}>
      <Surface className="relative flex h-full flex-col overflow-hidden p-5 transition-shadow duration-300 hover:shadow-lift">
        <div className="flex items-start justify-between gap-2">
          <IconPill tone={tone}>{icon}</IconPill>
          {compare && <Delta value={delta} good={good} />}
        </div>
        <p className="mt-4 text-[13px] font-medium text-muted-foreground" title={hint}>
          {label}
        </p>
        <p className="font-display mt-1 text-[22px] leading-tight font-semibold tracking-tight whitespace-nowrap xl:text-2xl">
          {percent === null ? "—" : <CountUp value={value} format={format} />}
        </p>
        <div className="mt-1 flex h-5 items-center gap-0.5">
          {money && (
            <>
              <SecondaryMoney value={money[second]} currency={second} className="mt-0" />
              <RateTip />
            </>
          )}
        </div>
        <Sparkline data={spark} color={color} className="-mx-5 mt-2 -mb-5 w-[calc(100%+2.5rem)]" />
      </Surface>
    </motion.div>
  );
}
