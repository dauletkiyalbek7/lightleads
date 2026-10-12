"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useMemo } from "react";
import { ChartLegend, MoneyChart } from "@/components/charts/money-chart";
import { PlatformIcon } from "@/components/kit/brand";
import { Btn } from "@/components/kit/btn";
import { CreativeThumb } from "@/components/kit/creative-thumb";
import { Money } from "@/components/kit/money";
import { Stagger, StaggerItem } from "@/components/kit/motion";
import { BadgePill, Pill, RomiPill, StatusDot } from "@/components/kit/pills";
import { ScoreRing } from "@/components/kit/score-ring";
import { EmptyState, PageSkeleton } from "@/components/kit/states";
import { Section, Surface } from "@/components/kit/surface";
import { t } from "@/i18n";
import { aggregate, saleMoney } from "@/lib/analytics";
import { formatDate } from "@/lib/dates";
import { formatInt, formatNumber, formatPercent, formatRatio } from "@/lib/format";
import { deriveDual } from "@/lib/metrics";
import { formatPhone } from "@/lib/phone";
import { useApp } from "@/lib/store";
import type { Dual } from "@/lib/types";

const SCORE_PARTS = [
  { key: "romi", weight: 45, label: t.metric.romi },
  { key: "cac", weight: 20, label: t.metric.cac },
  { key: "cr", weight: 20, label: t.metric.cr },
  { key: "ctr", weight: 15, label: t.metric.ctr },
] as const;

function Stat({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div className="rounded-2xl bg-muted/60 p-3.5" title={hint}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="num mt-1 text-[15px] font-semibold">{children}</dd>
    </div>
  );
}

export default function CreativePage() {
  const { id } = useParams<{ id: string }>();
  const { ready, ds, sales, attributions, analytics, range, currency } = useApp();

  const stat = analytics.stats.find((s) => s.creative.id === id);
  const adIds = useMemo(() => new Set(ds.ads.filter((a) => a.creativeId === id).map((a) => a.id)), [ds.ads, id]);
  const own = useMemo(() => aggregate(ds, sales, attributions, range, { adIds }), [ds, sales, attributions, range, adIds]);
  const creativeSales = useMemo(
    () =>
      sales.filter((s) => {
        const adId = attributions.get(s.id)?.adId;
        return adId && adIds.has(adId) && s.date >= range.from && s.date <= range.to;
      }),
    [sales, attributions, adIds, range],
  );

  if (!ready) return <PageSkeleton variant="dashboard" />;
  if (!stat) {
    return (
      <Surface>
        <EmptyState title={t.creatives.notFound} action={<Btn href="/creatives">{t.creatives.backToList}</Btn>} />
      </Surface>
    );
  }

  const { creative, ad, totals, score, badge, parts } = stat;
  const campaign = ds.campaigns.find((c) => c.id === ad.campaignId);
  const adset = ds.adsets.find((a) => a.id === ad.adsetId);
  const dd = deriveDual(totals);
  const d = dd[currency];
  const pair = (k: "cpl" | "cac" | "cpm" | "aov" | "revenue" | "profit" | "spend"): Dual | null => {
    const usd = dd.USD[k];
    const kzt = dd.KZT[k];
    return usd === null || kzt === null ? null : { USD: usd, KZT: kzt };
  };
  const productName = (pid: string | null) => ds.products.find((p) => p.id === pid)?.name ?? t.sales.noProduct;

  return (
    <div className="space-y-4 md:space-y-6">
      <Link href="/creatives" className="inline-flex min-h-10 items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-brand">
        <ArrowLeft className="size-4" />
        {t.creatives.backToList}
      </Link>

      <Stagger className="grid gap-4 md:gap-6 lg:grid-cols-[280px_1fr] xl:grid-cols-[320px_1fr]">
        <StaggerItem>
          <Surface className="group p-3">
            <CreativeThumb creative={creative} platform={ad.platform} />
            <div className="space-y-3 p-2 pt-4">
              <p className="text-xs font-medium tracking-wide text-subtle uppercase">{t.creatives.adText}</p>
              <dl className="space-y-2.5 text-sm">
                <div>
                  <dt className="text-xs text-muted-foreground">{t.creatives.title}</dt>
                  <dd className="font-medium">{creative.title}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">{t.creatives.body}</dt>
                  <dd className="leading-relaxed text-muted-foreground">{creative.body}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">{t.creatives.cta}</dt>
                  <dd>
                    <Pill tone="brand">{creative.cta}</Pill>
                  </dd>
                </div>
              </dl>
              <p className="text-[11px] text-subtle">{t.creatives.demoPreview}</p>
            </div>
          </Surface>
        </StaggerItem>

        <div className="min-w-0 space-y-4 md:space-y-6">
          <StaggerItem>
            <Surface className="p-5 md:p-6">
              <div className="flex flex-wrap items-start gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <PlatformIcon platform={ad.platform} />
                    <h2 className="font-display text-xl font-semibold tracking-tight break-all">{creative.name}</h2>
                    <BadgePill badge={badge} />
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {campaign?.name} · {adset?.name}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-3">
                    <StatusDot status={ad.status} label />
                    <span className="text-xs text-subtle">
                      {t.creatives.type[creative.type]} · {formatDate(ad.startDate)}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-4" title={t.creatives.scoreHint}>
                  <ScoreRing score={score} size="lg" />
                  <dl className="hidden w-40 space-y-1.5 sm:block">
                    {SCORE_PARTS.map((part) => (
                      <div key={part.key} className="flex items-center gap-2 text-[11px] text-muted-foreground">
                        <dt className="w-16 shrink-0">{part.label}</dt>
                        <dd className="h-1.5 flex-1 overflow-hidden rounded-full bg-brand-soft">
                          <span className="block h-full rounded-full bg-brand-fill" style={{ width: `${Math.round(parts[part.key] * 100)}%` }} />
                        </dd>
                      </div>
                    ))}
                  </dl>
                </div>
              </div>

              <dl className="mt-5 grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-5">
                <Stat label={t.metric.spend}>
                  <Money value={pair("spend")} />
                </Stat>
                <Stat label={t.metric.revenue}>
                  <Money value={pair("revenue")} />
                </Stat>
                <Stat label={t.metric.profit} hint={t.metricHint.profit}>
                  <Money value={pair("profit")} />
                </Stat>
                <Stat label={t.metric.romi} hint={t.metricHint.romi}>
                  <RomiPill value={d.romi} />
                </Stat>
                <Stat label={t.metric.roas} hint={t.metricHint.roas}>
                  {formatRatio(d.roas)}
                </Stat>
                <Stat label={t.metric.leads}>{formatInt(totals.leads)}</Stat>
                <Stat label={t.metric.cplLong}>
                  <Money value={pair("cpl")} />
                </Stat>
                <Stat label={t.metric.sales}>{formatInt(totals.sales)}</Stat>
                <Stat label={t.metric.cacLong}>
                  <Money value={pair("cac")} />
                </Stat>
                <Stat label={t.metric.crLong}>{formatPercent(d.cr)}</Stat>
                <Stat label={t.metric.impressions}>{formatInt(totals.impressions)}</Stat>
                <Stat label={t.metric.ctr}>{formatPercent(d.ctr, 2)}</Stat>
                <Stat label={t.metric.frequency}>{d.frequency === null ? "—" : formatNumber(d.frequency, 2)}</Stat>
                {creative.type === "video" && (
                  <>
                    <Stat label={t.metric.hookRate} hint={t.metricHint.hookRate}>
                      {formatPercent(d.hookRate)}
                    </Stat>
                    <Stat label={t.metric.holdRate} hint={t.metricHint.holdRate}>
                      {formatPercent(d.holdRate)}
                    </Stat>
                    <Stat label={t.metric.avgWatch}>
                      {d.avgWatchSec === null ? "—" : `${formatNumber(d.avgWatchSec, 1)} ${t.metric.seconds}`}
                    </Stat>
                  </>
                )}
              </dl>
            </Surface>
          </StaggerItem>

          <StaggerItem>
            <Section title={t.creatives.byDay} hint={<ChartLegend />} bodyClassName="pt-4">
              <MoneyChart daily={own.daily} currency={currency} height={260} />
            </Section>
          </StaggerItem>

          <StaggerItem>
            <Section title={t.creatives.salesList} bodyClassName="px-2 pt-2 pb-2 md:px-3">
              {creativeSales.length ? (
                <ul>
                  {creativeSales.map((s) => (
                    <li key={s.id} className="flex min-h-14 items-center gap-3 rounded-2xl px-3 py-2 hover:bg-muted/60">
                      <div className="min-w-0 flex-1">
                        <p className="num truncate text-sm font-medium">{formatPhone(s.phone)}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {formatDate(s.date)} · {productName(s.productId)}
                        </p>
                      </div>
                      <Pill>{t.sales.inputs[s.input]}</Pill>
                      <Money
                        value={saleMoney(s, ds.rates).revenue}
                        primary={s.currency}
                        align="right"
                        primaryClassName="text-sm"
                      />
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState compact title={t.creatives.noSales} />
              )}
            </Section>
          </StaggerItem>
        </div>
      </Stagger>
    </div>
  );
}
