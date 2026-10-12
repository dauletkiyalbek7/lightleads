"use client";

import { ChevronRight, Plus, TriangleAlert, Upload } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState } from "react";
import { toast } from "sonner";
import { NO_AD, useAdOptions } from "@/components/features/sale-dialog";
import { SalesImporter } from "@/components/features/sales-importer";
import { PlatformIcon } from "@/components/kit/brand";
import { Btn } from "@/components/kit/btn";
import { Picker, SearchInput } from "@/components/kit/field";
import { Money, RateTip } from "@/components/kit/money";
import { Stagger, StaggerItem } from "@/components/kit/motion";
import { Modal } from "@/components/kit/overlay";
import { Pill } from "@/components/kit/pills";
import { Segmented } from "@/components/kit/segmented";
import { EmptyState, PageSkeleton } from "@/components/kit/states";
import { Surface } from "@/components/kit/surface";
import { plural, t } from "@/i18n";
import { saleMoney } from "@/lib/analytics";
import { findDuplicate, type Attribution } from "@/lib/attribution";
import { addDual, zeroDual } from "@/lib/currency";
import { addDays, diffDays, formatDate, formatDayShort, inRange } from "@/lib/dates";
import { formatInt } from "@/lib/format";
import { agoLabel } from "@/lib/labels";
import { formatPhone } from "@/lib/phone";
import { useApp } from "@/lib/store";
import type { Sale } from "@/lib/types";
import { cn } from "@/lib/utils";

type Filter = "all" | "unattributed" | "duplicates";
const PAGE_SIZE = 30;

function SourceCell({ attribution, compact }: { attribution?: Attribution; compact?: boolean }) {
  const { ds } = useApp();
  const ad = attribution?.adId ? ds.ads.find((a) => a.id === attribution.adId) : null;
  if (!ad) {
    return (
      <Pill tone="warning">
        <TriangleAlert className="size-3.5" />
        {t.sales.unknownSource}
      </Pill>
    );
  }
  return (
    <span className="flex min-w-0 items-center gap-2">
      <PlatformIcon platform={ad.platform} size="sm" />
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium">{ad.name}</span>
        {!compact && attribution?.mode === "manual" && <span className="block text-xs text-subtle">{t.sales.manualSource}</span>}
      </span>
    </span>
  );
}

function SaleDetail({ sale, onClose }: { sale: Sale | null; onClose: () => void }) {
  const { ds, sales, attributions, settings, updateSale } = useApp();
  const adOptions = useAdOptions(ds);
  if (!sale) return <Modal open={false} onOpenChange={onClose} title={t.sales.detailTitle}>{null}</Modal>;

  const attribution = attributions.get(sale.id);
  const duplicate = findDuplicate(sale, sales);
  const { revenue, cogs } = saleMoney(sale, ds.rates);
  const profit = { USD: revenue.USD - cogs.USD, KZT: revenue.KZT - cogs.KZT };
  const product = ds.products.find((p) => p.id === sale.productId);
  const windowStart = addDays(sale.date, -settings.attributionWindow);
  const adName = (id: string | null) => ds.ads.find((a) => a.id === id)?.name ?? t.leads.noAd;
  const canPickSource = attribution?.mode !== "auto";

  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={t.sales.detailTitle} description={`${formatPhone(sale.phone)} · ${formatDate(sale.date)}`}>
      <div className="space-y-5 pt-1">
        <div className="flex items-start justify-between gap-4 rounded-[20px] bg-muted/60 p-4">
          <div>
            <p className="text-xs text-muted-foreground">{t.sales.amount}</p>
            <div className="mt-1 flex items-center gap-1">
              <Money value={revenue} primary={sale.currency} primaryClassName="font-display text-xl" />
              <RateTip date={sale.date} />
            </div>
          </div>
          <div className="text-right">
            <p className="text-xs text-muted-foreground">{t.sales.profit}</p>
            <Money value={profit} primary={sale.currency} align="right" className="mt-1" primaryClassName="text-success" />
          </div>
        </div>

        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
          <div>
            <dt className="text-xs text-muted-foreground">{t.sales.customer}</dt>
            <dd className="font-medium">{sale.customerName || "—"}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">{t.sales.product}</dt>
            <dd className="font-medium">{product?.name ?? t.sales.noProduct}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">{t.sales.input}</dt>
            <dd className="font-medium">{t.sales.inputs[sale.input]}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">{t.sales.by}</dt>
            <dd className="font-medium">{sale.createdBy || "—"}</dd>
          </div>
          {sale.comment && (
            <div className="col-span-2">
              <dt className="text-xs text-muted-foreground">{t.sales.comment}</dt>
              <dd>{sale.comment}</dd>
            </div>
          )}
        </dl>

        {duplicate && (
          <div className="flex gap-2.5 rounded-2xl border border-warning/30 bg-warning/8 p-3.5 text-sm leading-snug">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" />
            <p>{t.sales.duplicateHint({ date: formatDate(duplicate.date), input: t.sales.inputs[duplicate.input] })}</p>
          </div>
        )}

        <div>
          <p className="font-display text-sm font-semibold">{t.sales.source}</p>
          <div className="mt-2.5">
            <SourceCell attribution={attribution} />
          </div>
          {canPickSource && (
            <div className="mt-3">
              <p className="mb-1.5 text-xs text-muted-foreground">{t.sales.chooseSource}</p>
              <Picker
                value={sale.manualAdId ?? NO_AD}
                onChange={(v) => {
                  updateSale(sale.id, { manualAdId: v === NO_AD ? null : v });
                  toast.success(t.sales.sourceSaved);
                }}
                options={adOptions}
                ariaLabel={t.sales.chooseSourcePlaceholder}
              />
            </div>
          )}
        </div>

        <div>
          <p className="font-display text-sm font-semibold">{t.sales.touches}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {t.sales.touchesHint({
              model: settings.attributionModel === "last" ? t.settings.attribution.lastWord : t.settings.attribution.firstWord,
              window: settings.attributionWindow,
            })}
          </p>
          {attribution?.history.length ? (
            <ol className="mt-3 space-y-0">
              {attribution.history.map((lead, i) => {
                const winner = attribution.lead?.id === lead.id;
                const outside = lead.date < windowStart || lead.date > sale.date;
                return (
                  <li key={lead.id} className="relative flex gap-3 pb-4 last:pb-0">
                    {i < attribution.history.length - 1 && <span className="absolute top-4 left-[7px] h-full w-px bg-border" />}
                    <span className={cn("relative mt-1 size-[15px] shrink-0 rounded-full border-[3px] border-card", winner ? "bg-brand shadow-[0_0_0_3px_rgba(109,91,255,0.2)]" : "bg-subtle/60")} />
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium">
                        {adName(lead.adId)}
                        {winner && <Pill tone="brand" className="px-2 py-0.5 text-[11px]">{t.sales.touchWinner}</Pill>}
                        {outside && <span className="text-xs font-normal text-subtle">{t.sales.touchOutside}</span>}
                      </p>
                      <p className="num text-xs text-muted-foreground">
                        {formatDate(lead.date)} · {t.leads.sources[lead.source]} · {agoLabel(diffDays(sale.date, lead.date))}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ol>
          ) : (
            <p className="mt-3 rounded-2xl bg-muted/60 p-3.5 text-sm text-muted-foreground">{t.sales.noTouches}</p>
          )}
        </div>
      </div>
    </Modal>
  );
}

function SalesView() {
  const params = useSearchParams();
  const { ready, isEmpty, ds, sales, attributions, range, setSaleDialogOpen } = useApp();
  const [filter, setFilter] = useState<Filter>(params.get("filter") === "unattributed" ? "unattributed" : "all");
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  const inPeriod = useMemo(() => sales.filter((s) => inRange(s.date, range)), [sales, range]);
  const duplicateIds = useMemo(() => new Set(inPeriod.filter((s) => findDuplicate(s, sales)).map((s) => s.id)), [inPeriod, sales]);
  const productName = useMemo(() => new Map(ds.products.map((p) => [p.id, p.name])), [ds.products]);
  const isUnattributed = (s: Sale) => !attributions.get(s.id)?.adId;

  const summary = useMemo(() => {
    const revenue = zeroDual();
    for (const s of inPeriod) addDual(revenue, saleMoney(s, ds.rates).revenue);
    const n = inPeriod.length || 1;
    return { revenue, aov: { USD: revenue.USD / n, KZT: revenue.KZT / n }, unattributed: inPeriod.filter((s) => !attributions.get(s.id)?.adId).length };
  }, [inPeriod, ds.rates, attributions]);

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    const digits = q.replace(/\D/g, "");
    return inPeriod.filter((s) => {
      if (filter === "unattributed" && attributions.get(s.id)?.adId) return false;
      if (filter === "duplicates" && !duplicateIds.has(s.id)) return false;
      if (!q) return true;
      return (
        (digits.length > 2 && s.phone.includes(digits)) ||
        s.customerName.toLowerCase().includes(q) ||
        (productName.get(s.productId ?? "") ?? "").toLowerCase().includes(q)
      );
    });
  }, [inPeriod, filter, query, attributions, duplicateIds, productName]);

  if (!ready) return <PageSkeleton />;

  const selected = sales.find((s) => s.id === selectedId) ?? null;
  const shown = list.slice(0, limit);

  return (
    <div className="space-y-4">
      <Stagger className="grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-4">
        <StaggerItem>
          <Surface className="h-full p-4 md:p-5">
            <p className="text-[13px] text-muted-foreground">{t.sales.count}</p>
            <p className="num font-display mt-1 text-xl font-semibold md:text-2xl">{formatInt(inPeriod.length)}</p>
          </Surface>
        </StaggerItem>
        <StaggerItem>
          <Surface className="h-full p-4 md:p-5">
            <p className="text-[13px] text-muted-foreground">{t.sales.revenue}</p>
            <Money value={summary.revenue} className="mt-1" primaryClassName="font-display text-lg md:text-2xl" round />
          </Surface>
        </StaggerItem>
        <StaggerItem>
          <Surface className="h-full p-4 md:p-5">
            <p className="text-[13px] text-muted-foreground">{t.sales.aov}</p>
            <Money value={inPeriod.length ? summary.aov : null} className="mt-1" primaryClassName="font-display text-lg md:text-2xl" round />
          </Surface>
        </StaggerItem>
        <StaggerItem>
          <Surface className="h-full p-4 md:p-5">
            <p className="text-[13px] text-muted-foreground">{t.sales.unattributed}</p>
            <p className={cn("num font-display mt-1 text-xl font-semibold md:text-2xl", summary.unattributed > 0 && "text-warning")}>
              {formatInt(summary.unattributed)}
            </p>
          </Surface>
        </StaggerItem>
      </Stagger>

      <div className="flex flex-wrap items-center gap-2">
        <SearchInput
          placeholder={t.sales.searchPlaceholder}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="min-w-0 flex-1 basis-full md:max-w-xs md:basis-auto [&_input]:md:h-10"
        />
        <Segmented
          value={filter}
          onChange={setFilter}
          scroll
          options={[
            { value: "all", label: t.sales.filterAll },
            { value: "unattributed", label: t.sales.filterUnattributed },
            { value: "duplicates", label: t.sales.filterDuplicates },
          ]}
        />
        <div className="ml-auto flex items-center gap-2">
          <Btn variant="secondary" size="sm" className="h-11 md:h-10" onClick={() => setImportOpen(true)}>
            <Upload />
            {t.sales.import}
          </Btn>
          <Btn size="sm" className="hidden h-10 md:inline-flex" onClick={() => setSaleDialogOpen(true)}>
            <Plus />
            {t.sales.add}
          </Btn>
        </div>
      </div>

      {!shown.length ? (
        <Surface>
          <EmptyState
            title={isEmpty || !sales.length ? t.common.noData : t.common.notFoundTitle}
            text={isEmpty || !sales.length ? t.common.noDataHint : t.common.notFoundHint}
            action={<Btn onClick={() => setSaleDialogOpen(true)}>{t.sales.form.submit}</Btn>}
          />
        </Surface>
      ) : (
        <>
          <Surface className="hidden overflow-hidden md:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-muted-foreground">
                  <th className="px-5 py-3.5 text-left font-medium">{t.sales.date}</th>
                  <th className="px-4 py-3.5 text-left font-medium">{t.sales.customer}</th>
                  <th className="hidden px-4 py-3.5 text-left font-medium lg:table-cell">{t.sales.product}</th>
                  <th className="px-4 py-3.5 text-right font-medium">{t.sales.amount}</th>
                  <th className="px-4 py-3.5 text-left font-medium">{t.sales.source}</th>
                  <th className="hidden px-4 py-3.5 text-left font-medium xl:table-cell">{t.sales.input}</th>
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody>
                {shown.map((s) => (
                  <tr
                    key={s.id}
                    tabIndex={0}
                    onClick={() => setSelectedId(s.id)}
                    onKeyDown={(e) => e.key === "Enter" && setSelectedId(s.id)}
                    className="cursor-pointer border-b border-border outline-none transition-colors last:border-0 hover:bg-muted/50 focus-visible:bg-brand-soft/60"
                  >
                    <td className="num px-5 py-3 whitespace-nowrap text-muted-foreground">{formatDayShort(s.date)}</td>
                    <td className="px-4 py-3">
                      <p className="num font-medium whitespace-nowrap">{formatPhone(s.phone)}</p>
                      <p className="text-xs text-muted-foreground">{s.customerName || "—"}</p>
                    </td>
                    <td className="hidden max-w-48 truncate px-4 py-3 text-muted-foreground lg:table-cell">
                      {productName.get(s.productId ?? "") ?? t.sales.noProduct}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Money value={saleMoney(s, ds.rates).revenue} primary={s.currency} align="right" />
                    </td>
                    <td className="max-w-56 px-4 py-3">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <SourceCell attribution={attributions.get(s.id)} />
                        {duplicateIds.has(s.id) && <Pill tone="warning">{t.sales.duplicate}</Pill>}
                      </div>
                    </td>
                    <td className="hidden px-4 py-3 xl:table-cell">
                      <Pill>{t.sales.inputs[s.input]}</Pill>
                    </td>
                    <td className="pr-4 text-subtle">
                      <ChevronRight className="size-4" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Surface>

          <ul className="space-y-2.5 md:hidden">
            {shown.map((s) => (
              <li key={s.id}>
                <button type="button" onClick={() => setSelectedId(s.id)} className="block w-full text-left outline-none">
                  <Surface className="p-4 active:bg-muted/40">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="num text-[15px] font-semibold">{formatPhone(s.phone)}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {formatDayShort(s.date)} · {productName.get(s.productId ?? "") ?? t.sales.noProduct}
                        </p>
                      </div>
                      <Money value={saleMoney(s, ds.rates).revenue} primary={s.currency} align="right" />
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-1.5">
                      <SourceCell attribution={attributions.get(s.id)} compact />
                      {duplicateIds.has(s.id) && <Pill tone="warning">{t.sales.duplicate}</Pill>}
                      {isUnattributed(s) && <span className="ml-auto text-xs font-medium text-brand">{t.sales.setSource}</span>}
                    </div>
                  </Surface>
                </button>
              </li>
            ))}
          </ul>

          <div className="flex flex-col items-center gap-2 pt-1">
            <p className="num text-xs text-subtle">
              {shown.length} / {list.length} {plural(list.length, t.common.saleForms)}
            </p>
            {list.length > limit && (
              <Btn variant="secondary" onClick={() => setLimit((l) => l + PAGE_SIZE)}>
                {t.common.showMore}
              </Btn>
            )}
          </div>
        </>
      )}

      <SaleDetail sale={selected} onClose={() => setSelectedId(null)} />
      <SalesImporter open={importOpen} onOpenChange={setImportOpen} />
    </div>
  );
}

export default function SalesPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <SalesView />
    </Suspense>
  );
}
