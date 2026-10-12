"use client";

import { useReducedMotion } from "framer-motion";
import { useId } from "react";
import { Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { SecondaryMoney } from "@/components/kit/money";
import { t } from "@/i18n";
import type { DayPoint } from "@/lib/analytics";
import { otherCurrency } from "@/lib/currency";
import { formatDayLong, formatDayShort } from "@/lib/dates";
import { formatCompactMoney, formatInt, formatMoney } from "@/lib/format";
import type { Currency } from "@/lib/types";

/** Цвета серий берутся из темы (globals.css); каждая пара проверена на различимость при дальтонизме. */
export const SERIES = {
  revenue: { color: "var(--series-revenue)", label: t.metric.revenue },
  spend: { color: "var(--series-spend)", label: t.metric.spend },
} as const;

const GRID = "#EEF0F6";
const AXIS_TEXT = "#98A2B3";
const CHART_HEIGHT = 300;
const ANIMATION_MS = 900;

interface Row {
  date: string;
  revenue: number;
  spend: number;
  point: DayPoint;
}

function ChartTooltip({ active, payload, currency }: { active?: boolean; payload?: { payload: Row }[]; currency: Currency }) {
  if (!active || !payload?.length) return null;
  const { point } = payload[0].payload;
  const second = otherCurrency(currency);
  return (
    <div className="min-w-48 rounded-2xl border border-border bg-card p-3.5 shadow-lift">
      <p className="text-xs font-medium text-muted-foreground">{formatDayLong(point.date)}</p>
      <div className="mt-2.5 space-y-2.5">
        {(["revenue", "spend"] as const).map((key) => (
          <div key={key} className="flex items-start justify-between gap-6">
            <span className="flex items-center gap-2 pt-0.5 text-[13px] text-muted-foreground">
              <span className="size-2.5 rounded-full" style={{ background: SERIES[key].color }} />
              {SERIES[key].label}
            </span>
            <span className="flex flex-col items-end leading-tight">
              <span className="num text-sm font-semibold">{formatMoney(point[key][currency], currency)}</span>
              <SecondaryMoney value={point[key][second]} currency={second} />
            </span>
          </div>
        ))}
      </div>
      <div className="num mt-2.5 flex gap-4 border-t border-border pt-2.5 text-xs text-muted-foreground">
        <span>
          {t.metric.leads}: <b className="font-semibold text-foreground">{formatInt(point.leads)}</b>
        </span>
        <span>
          {t.metric.sales}: <b className="font-semibold text-foreground">{formatInt(point.sales)}</b>
        </span>
      </div>
    </div>
  );
}

/** Расход и выручка по дням: одна ось (деньги в валюте отображения), линия + заливка 10%. */
export function MoneyChart({ daily, currency, height = CHART_HEIGHT }: { daily: DayPoint[]; currency: Currency; height?: number }) {
  const gradientId = useId();
  const reduce = useReducedMotion();
  const rows: Row[] = daily.map((point) => ({
    date: point.date,
    revenue: point.revenue[currency],
    spend: point.spend[currency],
    point,
  }));
  const animate = !reduce;

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={SERIES.revenue.color} stopOpacity={0.16} />
            <stop offset="1" stopColor={SERIES.revenue.color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis
          dataKey="date"
          tickFormatter={formatDayShort}
          tickLine={false}
          axisLine={false}
          tick={{ fontSize: 12, fill: AXIS_TEXT }}
          minTickGap={28}
          tickMargin={10}
        />
        <YAxis
          tickFormatter={(v: number) => formatCompactMoney(v, currency)}
          tickLine={false}
          axisLine={false}
          tick={{ fontSize: 12, fill: AXIS_TEXT }}
          width={68}
        />
        <Tooltip content={<ChartTooltip currency={currency} />} cursor={{ stroke: "#D5D9E6", strokeWidth: 1 }} />
        <Area
          type="monotone"
          dataKey="revenue"
          stroke={SERIES.revenue.color}
          strokeWidth={2}
          fill={`url(#${gradientId})`}
          dot={false}
          activeDot={{ r: 5, stroke: "#fff", strokeWidth: 2 }}
          isAnimationActive={animate}
          animationDuration={ANIMATION_MS}
        />
        <Line
          type="monotone"
          dataKey="spend"
          stroke={SERIES.spend.color}
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 5, stroke: "#fff", strokeWidth: 2 }}
          isAnimationActive={animate}
          animationDuration={ANIMATION_MS}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

/** Легенда: цвет несёт метка рядом с текстом, сам текст — обычными чернилами. */
export function ChartLegend() {
  return (
    <div className="flex items-center gap-4 text-[13px] text-muted-foreground">
      {(["revenue", "spend"] as const).map((key) => (
        <span key={key} className="flex items-center gap-2">
          <span className="h-0.5 w-4 rounded-full" style={{ background: SERIES[key].color }} />
          {SERIES[key].label}
        </span>
      ))}
    </div>
  );
}
