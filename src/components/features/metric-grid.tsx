"use client";

import type { ReactNode } from "react";
import { Money } from "@/components/kit/money";
import { Delta } from "@/components/kit/pills";
import { t } from "@/i18n";
import { formatInt, formatNumber, formatPercent, formatRatio } from "@/lib/format";
import { delta, type Derived, type DerivedDual, type Totals } from "@/lib/metrics";
import { useApp } from "@/lib/store";

type MoneyKey = "cpm" | "cpc" | "adCpl" | "cpl" | "cac" | "aov";
type CountKey = "impressions" | "reach" | "clicks" | "adLeads" | "leads";

interface Tile {
  label: string;
  hint?: string;
  /** Значение в выбранной валюте: по нему считается изменение к прошлому периоду. */
  value: (totals: Totals, d: Derived) => number | null;
  render: (totals: Totals, dd: DerivedDual, d: Derived) => ReactNode;
  /** Рост метрики — это хорошо, плохо или ни то ни другое. */
  good: "up" | "down" | "none";
}

const count = (key: CountKey, good: Tile["good"], hint?: string): Tile => ({
  label: t.metric[key],
  hint,
  good,
  value: (totals) => totals[key],
  render: (totals) => formatInt(totals[key]),
});

const money = (key: MoneyKey, label: string, hint?: string): Tile => ({
  label,
  hint,
  good: key === "aov" ? "up" : "down",
  value: (_, d) => d[key],
  render: (_, dd) => {
    const usd = dd.USD[key];
    const kzt = dd.KZT[key];
    return <Money value={usd === null || kzt === null ? null : { USD: usd, KZT: kzt }} />;
  },
});

/** Все метрики периода: от показов до средней стоимости продажи. */
const TILES: Tile[] = [
  count("adLeads", "up", t.metricHint.adLeads),
  money("adCpl", t.metric.adCpl, t.metricHint.adCpl),
  count("leads", "up", t.metricHint.leads),
  money("cpl", t.metric.cpl, t.metricHint.cpl),
  { label: t.metric.crLong, good: "up", value: (_, d) => d.cr, render: (_, __, d) => formatPercent(d.cr) },
  money("cac", t.metric.cacLong),
  money("aov", t.metric.aov),
  { label: t.metric.roas, hint: t.metricHint.roas, good: "up", value: (_, d) => d.roas, render: (_, __, d) => formatRatio(d.roas) },
  count("impressions", "none"),
  count("reach", "none"),
  { label: t.metric.frequency, good: "none", value: (_, d) => d.frequency, render: (_, __, d) => (d.frequency === null ? "—" : formatNumber(d.frequency, 2)) },
  money("cpm", t.metric.cpm),
  count("clicks", "up"),
  { label: t.metric.ctr, good: "up", value: (_, d) => d.ctr, render: (_, __, d) => formatPercent(d.ctr, 2) },
  money("cpc", t.metric.cpc),
];

interface MetricGridProps {
  totals: Totals;
  dd: DerivedDual;
  /** Прошлый период такой же длины: для изменения в процентах. */
  previous?: { totals: Totals; dd: DerivedDual };
}

/** Плитки со всеми метриками периода и изменением к прошлому периоду. */
export function MetricGrid({ totals, dd, previous }: MetricGridProps) {
  const { currency, compare } = useApp();
  const d = dd[currency];
  return (
    <dl className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
      {TILES.map((tile) => (
        <div key={tile.label} className="rounded-2xl bg-muted/60 p-3.5" title={tile.hint}>
          <dt className="flex items-start justify-between gap-2 text-xs text-muted-foreground">
            <span>{tile.label}</span>
            {compare && previous && (
              <Delta value={delta(tile.value(totals, d), tile.value(previous.totals, previous.dd[currency]))} good={tile.good} />
            )}
          </dt>
          <dd className="num mt-1 text-[15px] font-semibold">{tile.render(totals, dd, d)}</dd>
        </div>
      ))}
    </dl>
  );
}
