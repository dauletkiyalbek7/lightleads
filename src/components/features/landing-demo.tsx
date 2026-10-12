"use client";

import { Banknote, PiggyBank, TrendingUp, Wallet } from "lucide-react";
import { ChartLegend, MoneyChart } from "@/components/charts/money-chart";
import { smooth } from "@/components/charts/sparkline";
import { KpiCard } from "@/components/features/kpi-card";
import { Sk } from "@/components/kit/states";
import { t } from "@/i18n";
import { delta, deriveDual } from "@/lib/metrics";
import { AppProvider, useApp } from "@/lib/store";

function Board() {
  const { ready, analytics, currency } = useApp();
  if (!ready) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <Sk key={i} className="h-40 rounded-[20px]" />
          ))}
        </div>
        <Sk className="h-72 rounded-[20px]" />
      </div>
    );
  }
  const { period, previous } = analytics;
  const cur = deriveDual(period.total);
  const prev = deriveDual(previous.total)[currency];
  const c = cur[currency];
  const pair = (k: "spend" | "revenue" | "profit") => ({ USD: cur.USD[k], KZT: cur.KZT[k] });
  const profit = smooth(period.daily.map((d) => d.revenue[currency] - d.cogs[currency] - d.spend[currency]));

  return (
    <div className="space-y-3 md:space-y-4">
      <div className="grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-4">
        <KpiCard label={t.metric.spend} icon={<Wallet />} tone="coral" color="#FF5C7A" money={pair("spend")} delta={delta(c.spend, prev.spend)} good="none" spark={period.daily.map((d) => d.spend[currency])} />
        <KpiCard label={t.metric.revenue} icon={<Banknote />} tone="brand" color="#6D5BFF" money={pair("revenue")} delta={delta(c.revenue, prev.revenue)} spark={smooth(period.daily.map((d) => d.revenue[currency]))} />
        <KpiCard label={t.metric.profit} icon={<PiggyBank />} tone="success" color="#12B76A" money={pair("profit")} delta={delta(c.profit, prev.profit)} spark={profit} />
        <KpiCard label={t.metric.romi} icon={<TrendingUp />} tone="brand" color="#6D5BFF" percent={c.romi} delta={delta(c.romi, prev.romi)} spark={profit} />
      </div>
      <div className="rounded-[20px] border border-border bg-card p-4 shadow-card md:p-6">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <p className="font-display text-sm font-semibold">{t.dashboard.chartTitle}</p>
          <ChartLegend />
        </div>
        <MoneyChart daily={period.daily} currency={currency} height={240} />
      </div>
    </div>
  );
}

/** Живой мини-дашборд на тех же компонентах и демо-данных, что и в приложении. */
export function LandingDemo() {
  return (
    <AppProvider>
      <Board />
    </AppProvider>
  );
}
