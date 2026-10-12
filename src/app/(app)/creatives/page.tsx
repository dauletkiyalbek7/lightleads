"use client";

import { LayoutGrid, List } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { PlatformIcon } from "@/components/kit/brand";
import { Btn } from "@/components/kit/btn";
import { CreativeThumb } from "@/components/kit/creative-thumb";
import { Picker } from "@/components/kit/field";
import { Money } from "@/components/kit/money";
import { Stagger, StaggerItem } from "@/components/kit/motion";
import { BadgePill, RomiPill } from "@/components/kit/pills";
import { ScoreRing } from "@/components/kit/score-ring";
import { Segmented } from "@/components/kit/segmented";
import { EmptyState, PageSkeleton } from "@/components/kit/states";
import { Surface } from "@/components/kit/surface";
import { t } from "@/i18n";
import { formatInt, formatPercent } from "@/lib/format";
import { deriveDual } from "@/lib/metrics";
import type { CreativeBadge, CreativeStat } from "@/lib/score";
import { useApp } from "@/lib/store";
import type { Currency, Platform } from "@/lib/types";

type SortKey = "score" | "romi" | "spend" | "sales" | "profit";
type View = "grid" | "table";
const SORT_KEYS: SortKey[] = ["score", "romi", "profit", "sales", "spend"];
const BADGES: CreativeBadge[] = ["leader", "growing", "fatigue", "burner", "lowdata"];
const NO_VALUE = -Infinity;

function sortValue(s: CreativeStat, key: SortKey, currency: Currency): number {
  const d = deriveDual(s.totals)[currency];
  if (key === "score") return s.score;
  if (key === "sales") return s.totals.sales;
  if (key === "romi") return d.romi ?? NO_VALUE;
  return d[key];
}

export default function CreativesPage() {
  const { ready, isEmpty, ds, analytics, currency, connectHref } = useApp();
  const [platform, setPlatform] = useState<Platform | "all">("all");
  const [badge, setBadge] = useState<CreativeBadge | "all">("all");
  const [sort, setSort] = useState<SortKey>("score");
  const [view, setView] = useState<View>("grid");

  const campaignName = useMemo(() => new Map(ds.campaigns.map((c) => [c.id, c.name])), [ds.campaigns]);
  const list = useMemo(
    () =>
      analytics.stats
        .filter((s) => s.totals.spend.USD > 0)
        .filter((s) => platform === "all" || s.ad.platform === platform)
        .filter((s) => badge === "all" || s.badge === badge)
        .sort((a, b) => sortValue(b, sort, currency) - sortValue(a, sort, currency)),
    [analytics.stats, platform, badge, sort, currency],
  );

  if (!ready) return <PageSkeleton variant="grid" />;
  if (isEmpty) {
    return (
      <Surface>
        <EmptyState title={t.dashboard.emptyTitle} text={t.dashboard.emptyText} action={<Btn href={connectHref}>{t.dashboard.emptyAction}</Btn>} />
      </Surface>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Segmented
          value={platform}
          onChange={setPlatform}
          full
          className="sm:inline-flex sm:w-auto"
          options={[
            { value: "all", label: t.common.all },
            { value: "meta", label: t.platform.meta, icon: <PlatformIcon platform="meta" size="sm" /> },
            { value: "tiktok", label: t.platform.tiktok, icon: <PlatformIcon platform="tiktok" size="sm" /> },
          ]}
        />
        <Picker
          ariaLabel={t.creatives.badgeAll}
          value={badge}
          onChange={setBadge}
          className="w-auto min-w-44 flex-1 sm:flex-none md:data-[size=default]:h-10"
          options={[{ value: "all", label: t.creatives.badgeAll }, ...BADGES.map((b) => ({ value: b, label: t.creatives.badge[b] }))]}
        />
        <Picker
          ariaLabel={t.creatives.sort}
          value={sort}
          onChange={setSort}
          className="w-auto min-w-40 flex-1 sm:flex-none md:data-[size=default]:h-10"
          options={SORT_KEYS.map((k) => ({ value: k, label: t.creatives.sortBy[k] }))}
        />
        <Segmented
          value={view}
          onChange={setView}
          className="ml-auto hidden md:inline-flex"
          options={[
            { value: "grid", label: <LayoutGrid />, ariaLabel: t.creatives.viewGrid },
            { value: "table", label: <List />, ariaLabel: t.creatives.viewTable },
          ]}
        />
      </div>

      {!list.length ? (
        <Surface>
          <EmptyState title={t.common.notFoundTitle} text={t.common.notFoundHint} />
        </Surface>
      ) : view === "grid" ? (
        <Stagger key={`${platform}-${badge}-${sort}`} className="grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-4 xl:grid-cols-4 2xl:grid-cols-5">
          {list.map((s) => {
            const dd = deriveDual(s.totals);
            return (
              <StaggerItem key={s.creative.id}>
                <Link
                  href={`/creatives/${s.creative.id}`}
                  className="group block h-full rounded-[20px] outline-none focus-visible:ring-4 focus-visible:ring-brand/25"
                >
                  <Surface className="flex h-full flex-col p-2.5 transition duration-300 group-hover:-translate-y-1 group-hover:shadow-lift md:p-3">
                    <CreativeThumb creative={s.creative} platform={s.ad.platform} />
                    <div className="flex flex-1 flex-col px-1 pt-3 pb-1">
                      <div className="flex items-center gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold">{s.creative.name}</p>
                          <p className="truncate text-xs text-muted-foreground">{campaignName.get(s.ad.campaignId)}</p>
                        </div>
                        <ScoreRing score={s.score} size="sm" />
                      </div>
                      <div className="mt-2 min-h-6">
                        <BadgePill badge={s.badge} className="px-2 py-0.5 text-[11px]" />
                      </div>
                      <dl className="num mt-auto grid grid-cols-2 gap-x-2 gap-y-2.5 pt-3 text-[13px]">
                        <div>
                          <dt className="text-[11px] text-muted-foreground">{t.metric.spend}</dt>
                          <dd>
                            <Money value={s.totals.spend} round />
                          </dd>
                        </div>
                        <div>
                          <dt className="text-[11px] text-muted-foreground">{t.metric.romi}</dt>
                          <dd className="mt-0.5">
                            <RomiPill value={dd[currency].romi} className="px-2 py-0.5" />
                          </dd>
                        </div>
                        <div>
                          <dt className="text-[11px] text-muted-foreground">{t.metric.leads}</dt>
                          <dd className="font-semibold">{formatInt(s.totals.leads)}</dd>
                        </div>
                        <div>
                          <dt className="text-[11px] text-muted-foreground">{t.metric.sales}</dt>
                          <dd className="font-semibold">{formatInt(s.totals.sales)}</dd>
                        </div>
                      </dl>
                    </div>
                  </Surface>
                </Link>
              </StaggerItem>
            );
          })}
        </Stagger>
      ) : (
        <Surface className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="num w-full border-separate border-spacing-0 text-sm">
              <thead>
                <tr className="text-xs text-muted-foreground">
                  <th className="sticky left-0 z-10 min-w-72 border-b border-border bg-card px-5 py-3.5 text-left font-medium">{t.creatives.creative}</th>
                  <th className="border-b border-border px-4 py-3.5 text-left font-medium">{t.creatives.score}</th>
                  {[t.metric.spend, t.metric.ctr, t.metric.leads, t.metric.cpl, t.metric.sales, t.metric.cac, t.metric.revenue, t.metric.profit, t.metric.romi].map((h) => (
                    <th key={h} className="border-b border-border px-4 py-3.5 text-right font-medium whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {list.map((s) => {
                  const dd = deriveDual(s.totals);
                  const pair = (k: "cpl" | "cac" | "revenue" | "profit") => {
                    const usd = dd.USD[k];
                    const kzt = dd.KZT[k];
                    return usd === null || kzt === null ? null : { USD: usd, KZT: kzt };
                  };
                  return (
                    <tr key={s.creative.id} className="group/row hover:bg-muted/40">
                      <td className="sticky left-0 z-10 border-b border-border bg-card px-5 py-2 group-hover/row:bg-[#FAFBFE]">
                        <Link href={`/creatives/${s.creative.id}`} className="flex items-center gap-3 outline-none hover:text-brand">
                          <CreativeThumb creative={s.creative} variant="mini" className="size-10 rounded-xl" />
                          <span className="min-w-0">
                            <span className="flex items-center gap-1.5 font-semibold">
                              <PlatformIcon platform={s.ad.platform} size="sm" />
                              <span className="truncate">{s.creative.name}</span>
                            </span>
                            <span className="block truncate text-xs font-normal text-muted-foreground">{campaignName.get(s.ad.campaignId)}</span>
                          </span>
                        </Link>
                      </td>
                      <td className="border-b border-border px-4 py-2">
                        <span className="flex items-center gap-2">
                          <ScoreRing score={s.score} size="sm" />
                          <BadgePill badge={s.badge} className="px-2 py-0.5 text-[11px]" />
                        </span>
                      </td>
                      <td className="border-b border-border px-4 py-2 text-right">
                        <Money value={s.totals.spend} align="right" primaryClassName="font-medium" />
                      </td>
                      <td className="border-b border-border px-4 py-2 text-right">{formatPercent(dd[currency].ctr, 2)}</td>
                      <td className="border-b border-border px-4 py-2 text-right font-medium">{formatInt(s.totals.leads)}</td>
                      <td className="border-b border-border px-4 py-2 text-right">
                        <Money value={pair("cpl")} align="right" primaryClassName="font-medium" />
                      </td>
                      <td className="border-b border-border px-4 py-2 text-right font-medium">{formatInt(s.totals.sales)}</td>
                      <td className="border-b border-border px-4 py-2 text-right">
                        <Money value={pair("cac")} align="right" primaryClassName="font-medium" />
                      </td>
                      <td className="border-b border-border px-4 py-2 text-right">
                        <Money value={pair("revenue")} align="right" primaryClassName="font-medium" />
                      </td>
                      <td className="border-b border-border px-4 py-2 text-right">
                        <Money value={pair("profit")} align="right" primaryClassName="font-medium" />
                      </td>
                      <td className="border-b border-border px-4 py-2 text-right">
                        <RomiPill value={dd[currency].romi} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Surface>
      )}
    </div>
  );
}
