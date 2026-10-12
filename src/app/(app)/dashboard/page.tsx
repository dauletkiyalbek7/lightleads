"use client";

import { ArrowRight, Banknote, PiggyBank, ShoppingBag, TrendingUp, TriangleAlert, Users, Wallet } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { ChartLegend, MoneyChart } from "@/components/charts/money-chart";
import { smooth } from "@/components/charts/sparkline";
import { AdviceCard } from "@/components/features/advice-card";
import { Funnel } from "@/components/features/funnel";
import { KpiCard } from "@/components/features/kpi-card";
import { PlatformIcon } from "@/components/kit/brand";
import { Btn } from "@/components/kit/btn";
import { CreativeThumb } from "@/components/kit/creative-thumb";
import { Money } from "@/components/kit/money";
import { Stagger, StaggerItem } from "@/components/kit/motion";
import { BadgePill, RomiPill } from "@/components/kit/pills";
import { ScoreRing } from "@/components/kit/score-ring";
import { Segmented } from "@/components/kit/segmented";
import { EmptyState, PageSkeleton } from "@/components/kit/states";
import { IconPill, Section, Surface } from "@/components/kit/surface";
import { plural, t } from "@/i18n";
import { buildAdvice } from "@/lib/advice";
import { formatDayShort } from "@/lib/dates";
import { formatInt } from "@/lib/format";
import { delta, deriveDual } from "@/lib/metrics";
import { useApp } from "@/lib/store";

const TOP_CREATIVES = 5;
const DASHBOARD_ADVICE = 3;
const COLORS = { spend: "#FF5C7A", leads: "#3D8BFF", sales: "#FFB020", revenue: "#6D5BFF", profit: "#12B76A" } as const;

type ChartView = "chart" | "table";

export default function DashboardPage() {
  const { ready, isEmpty, analytics, currency, setWorkspaceId, workspaces } = useApp();
  const [view, setView] = useState<ChartView>("chart");
  const { period, previous, stats, signals } = analytics;

  const cur = useMemo(() => deriveDual(period.total), [period]);
  const prev = useMemo(() => deriveDual(previous.total), [previous]);
  const spark = useMemo(() => {
    const d = period.daily;
    const profit = d.map((p) => p.revenue[currency] - p.cogs[currency] - p.spend[currency]);
    return {
      spend: d.map((p) => p.spend[currency]),
      leads: smooth(d.map((p) => p.leads)),
      sales: smooth(d.map((p) => p.sales)),
      revenue: smooth(d.map((p) => p.revenue[currency])),
      profit: smooth(profit),
    };
  }, [period, currency]);

  const top = useMemo(
    () => [...stats].filter((s) => s.totals.spend.USD > 0).sort((a, b) => b.score - a.score).slice(0, TOP_CREATIVES),
    [stats],
  );
  const advice = useMemo(() => signals.slice(0, DASHBOARD_ADVICE).map((s) => buildAdvice(s, currency)), [signals, currency]);

  if (!ready) return <PageSkeleton variant="dashboard" />;

  if (isEmpty) {
    return (
      <Surface>
        <EmptyState
          title={t.dashboard.emptyTitle}
          text={t.dashboard.emptyText}
          action={
            <>
              <Btn href="/onboarding">{t.dashboard.emptyAction}</Btn>
              <Btn variant="secondary" onClick={() => setWorkspaceId(workspaces[0].id)}>
                {t.dashboard.emptySecondary}
              </Btn>
            </>
          }
        />
      </Surface>
    );
  }

  const c = cur[currency];
  const p = prev[currency];
  const money = (key: "spend" | "revenue" | "profit") => ({ USD: cur.USD[key], KZT: cur.KZT[key] });
  const unattributed = period.unattributed.count;

  return (
    <div className="space-y-4 md:space-y-6">
      {/* KPI: на телефоне — горизонтальный скролл */}
      <Stagger className="no-scrollbar -mx-4 flex snap-x gap-3 overflow-x-auto px-4 py-1 md:mx-0 md:grid md:grid-cols-3 md:gap-4 md:overflow-visible md:px-0 2xl:grid-cols-6">
        {[
          <KpiCard key="spend" label={t.metric.spend} icon={<Wallet />} tone="coral" color={COLORS.spend} money={money("spend")} delta={delta(c.spend, p.spend)} good="none" spark={spark.spend} />,
          <KpiCard key="leads" label={t.metric.leads} icon={<Users />} tone="blue" color={COLORS.leads} count={period.total.leads} delta={delta(period.total.leads, previous.total.leads)} spark={spark.leads} />,
          <KpiCard key="sales" label={t.metric.sales} icon={<ShoppingBag />} tone="sun" color={COLORS.sales} count={period.total.sales} delta={delta(period.total.sales, previous.total.sales)} spark={spark.sales} />,
          <KpiCard key="revenue" label={t.metric.revenue} icon={<Banknote />} tone="brand" color={COLORS.revenue} money={money("revenue")} delta={delta(c.revenue, p.revenue)} spark={spark.revenue} />,
          <KpiCard key="profit" label={t.metric.profit} icon={<PiggyBank />} tone="success" color={COLORS.profit} money={money("profit")} delta={delta(c.profit, p.profit)} spark={spark.profit} hint={t.metricHint.profit} />,
          <KpiCard key="romi" label={t.metric.romi} icon={<TrendingUp />} tone="brand" color={COLORS.revenue} percent={c.romi} delta={delta(c.romi, p.romi)} spark={spark.profit} hint={t.metricHint.romi} />,
        ].map((card) => (
          <StaggerItem key={card.key} className="w-[232px] shrink-0 snap-start md:w-auto">
            {card}
          </StaggerItem>
        ))}
      </Stagger>

      {unattributed > 0 && (
        <Surface className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center md:px-6">
          <div className="flex flex-1 items-center gap-3">
            <IconPill tone="sun">
              <TriangleAlert />
            </IconPill>
            <div className="min-w-0">
              <p className="text-sm font-semibold">{t.dashboard.unattributedTitle(unattributed, plural(unattributed, t.common.saleForms))}</p>
              <p className="text-[13px] text-muted-foreground">{t.dashboard.unattributedHint}</p>
            </div>
          </div>
          <Btn href="/sales?filter=unattributed" variant="soft" size="sm" className="h-10 self-start sm:self-auto">
            {t.dashboard.unattributedAction}
            <ArrowRight />
          </Btn>
        </Surface>
      )}

      <Stagger className="grid gap-4 md:gap-6 xl:grid-cols-3">
        <StaggerItem className="min-w-0 xl:col-span-2">
          <Section
            title={t.dashboard.chartTitle}
            hint={view === "chart" ? <ChartLegend /> : undefined}
            action={
              <Segmented
                size="sm"
                value={view}
                onChange={setView}
                options={[
                  { value: "chart", label: t.dashboard.chartView },
                  { value: "table", label: t.dashboard.tableView },
                ]}
              />
            }
            className="h-full"
            bodyClassName="pt-4"
          >
            {view === "chart" ? (
              <MoneyChart daily={period.daily} currency={currency} />
            ) : (
              <div className="max-h-[300px] overflow-auto rounded-2xl border border-border">
                <table className="num w-full text-sm">
                  <thead className="sticky top-0 bg-muted text-xs text-muted-foreground">
                    <tr>
                      <th className="px-4 py-2.5 text-left font-medium">{t.dashboard.date}</th>
                      <th className="px-4 py-2.5 text-right font-medium">{t.metric.spend}</th>
                      <th className="px-4 py-2.5 text-right font-medium">{t.metric.revenue}</th>
                      <th className="px-4 py-2.5 text-right font-medium">{t.metric.leads}</th>
                      <th className="px-4 py-2.5 text-right font-medium">{t.metric.sales}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...period.daily].reverse().map((d) => (
                      <tr key={d.date} className="border-t border-border">
                        <td className="px-4 py-2 whitespace-nowrap">{formatDayShort(d.date)}</td>
                        <td className="px-4 py-2 text-right">
                          <Money value={d.spend} align="right" primaryClassName="font-medium" />
                        </td>
                        <td className="px-4 py-2 text-right">
                          <Money value={d.revenue} align="right" primaryClassName="font-medium" />
                        </td>
                        <td className="px-4 py-2 text-right">{formatInt(d.leads)}</td>
                        <td className="px-4 py-2 text-right">{formatInt(d.sales)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>
        </StaggerItem>

        <StaggerItem>
          <Section title={t.dashboard.funnelTitle} className="h-full">
            <Funnel totals={period.total} />
          </Section>
        </StaggerItem>
      </Stagger>

      <Stagger className="grid gap-4 md:gap-6 xl:grid-cols-2">
        <StaggerItem className="min-w-0">
          <Section
            title={t.dashboard.topCreatives}
            hint={t.dashboard.topCreativesHint}
            action={
              <Link href="/creatives" className="inline-flex min-h-11 items-center gap-1 text-[13px] font-medium text-brand hover:underline">
                {t.dashboard.allCreatives}
                <ArrowRight className="size-4" />
              </Link>
            }
            className="h-full"
            bodyClassName="px-2 pt-2 pb-2 md:px-3"
          >
            <ul>
              {top.map((s) => {
                const d = deriveDual(s.totals);
                return (
                  <li key={s.creative.id}>
                    <Link
                      href={`/creatives/${s.creative.id}`}
                      className="flex min-h-16 items-center gap-3 rounded-2xl px-3 py-2 outline-none transition hover:bg-muted/70 focus-visible:ring-4 focus-visible:ring-brand/25"
                    >
                      <CreativeThumb creative={s.creative} variant="mini" />
                      <div className="min-w-0 flex-1">
                        <p className="flex items-center gap-1.5 text-sm font-semibold">
                          <PlatformIcon platform={s.ad.platform} size="sm" />
                          <span className="truncate">{s.creative.name}</span>
                        </p>
                        <div className="mt-1 flex items-center gap-2">
                          <BadgePill badge={s.badge} className="px-2 py-0.5 text-[11px]" />
                          <span className="num hidden text-xs text-muted-foreground sm:inline">
                            {s.totals.sales} {plural(s.totals.sales, t.common.saleForms)}
                          </span>
                        </div>
                      </div>
                      <div className="hidden text-right sm:block">
                        <Money value={{ USD: d.USD.revenue, KZT: d.KZT.revenue }} align="right" primaryClassName="text-sm" round />
                      </div>
                      <RomiPill value={d.USD.romi} />
                      <ScoreRing score={s.score} size="sm" />
                    </Link>
                  </li>
                );
              })}
            </ul>
          </Section>
        </StaggerItem>

        <StaggerItem className="min-w-0">
          <Section
            title={t.dashboard.aiTitle}
            action={
              <Link href="/ai" className="inline-flex min-h-11 items-center gap-1 text-[13px] font-medium text-brand hover:underline">
                {t.dashboard.allAdvice}
                <ArrowRight className="size-4" />
              </Link>
            }
            className="h-full"
            bodyClassName="pt-4"
          >
            {advice.length ? (
              <ul className="space-y-3">
                {advice.map((a) => (
                  <li key={a.signal.id}>
                    <AdviceCard advice={a} flat />
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState compact title={t.ai.emptyTitle} text={t.ai.emptyText} />
            )}
          </Section>
        </StaggerItem>
      </Stagger>
    </div>
  );
}
