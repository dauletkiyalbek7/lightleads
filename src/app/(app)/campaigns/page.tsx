"use client";

import { AnimatePresence, motion } from "framer-motion";
import { ArrowDown, ArrowUp, ChevronRight, Columns3, SlidersHorizontal } from "lucide-react";
import Link from "next/link";
import { Fragment, useMemo, useState } from "react";
import { PlatformIcon } from "@/components/kit/brand";
import { Btn } from "@/components/kit/btn";
import { Picker, SearchInput } from "@/components/kit/field";
import { Money } from "@/components/kit/money";
import { Pop } from "@/components/kit/overlay";
import { RomiPill, StatusDot } from "@/components/kit/pills";
import { Segmented } from "@/components/kit/segmented";
import { EmptyState, PageSkeleton } from "@/components/kit/states";
import { Surface } from "@/components/kit/surface";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { t } from "@/i18n";
import { buildTree, DEFAULT_TREE_FILTER, type TreeFilter, type TreeNode } from "@/lib/analytics";
import { formatInt, formatPercent, formatRatio } from "@/lib/format";
import { addTotals, deriveDual, emptyTotals, type Derived, type DerivedDual, type Totals } from "@/lib/metrics";
import { useApp } from "@/lib/store";
import type { Currency, EntityStatus, Platform } from "@/lib/types";
import { cn } from "@/lib/utils";

type MoneyKey = "spend" | "cpm" | "cpc" | "cpl" | "cac" | "revenue" | "profit";
type IntKey = "impressions" | "clicks" | "leads" | "sales";
type PctKey = "ctr" | "cr";

type Column =
  | { key: MoneyKey; kind: "money" }
  | { key: IntKey; kind: "int" }
  | { key: PctKey; kind: "pct" }
  | { key: "romi"; kind: "romi" }
  | { key: "roas"; kind: "ratio" }
  | { key: "pixel"; kind: "pixel" };

type ColumnKey = Column["key"];

const COLUMNS: Column[] = [
  { key: "spend", kind: "money" },
  { key: "impressions", kind: "int" },
  { key: "cpm", kind: "money" },
  { key: "clicks", kind: "int" },
  { key: "ctr", kind: "pct" },
  { key: "cpc", kind: "money" },
  { key: "leads", kind: "int" },
  { key: "cpl", kind: "money" },
  { key: "sales", kind: "int" },
  { key: "cr", kind: "pct" },
  { key: "cac", kind: "money" },
  { key: "revenue", kind: "money" },
  { key: "profit", kind: "money" },
  { key: "romi", kind: "romi" },
  { key: "roas", kind: "ratio" },
  { key: "pixel", kind: "pixel" },
];
const DEFAULT_COLUMNS: ColumnKey[] = ["spend", "leads", "cpl", "sales", "cac", "revenue", "profit", "romi", "pixel"];
const INDENT_PX = { campaign: 0, adset: 28, ad: 56 } as const;

function sortValue(col: Column, totals: Totals, d: Derived): number | null {
  if (col.kind === "int") return totals[col.key];
  if (col.kind === "pixel") return totals.pixelPurchases;
  return d[col.key];
}

function Cell({ col, totals, dd, currency }: { col: Column; totals: Totals; dd: DerivedDual; currency: Currency }) {
  switch (col.kind) {
    case "money": {
      const usd = dd.USD[col.key];
      const kzt = dd.KZT[col.key];
      return <Money value={usd === null || kzt === null ? null : { USD: usd, KZT: kzt }} align="right" primaryClassName="font-medium" />;
    }
    case "int":
      return <span className="font-medium">{formatInt(totals[col.key])}</span>;
    case "pct":
      return <span>{formatPercent(dd[currency][col.key], col.key === "ctr" ? 2 : 1)}</span>;
    case "romi":
      return <RomiPill value={dd[currency].romi} />;
    case "ratio":
      return <span>{formatRatio(dd[currency].roas)}</span>;
    case "pixel":
      return totals.pixelPurchases ? (
        <span className="inline-flex flex-col items-end leading-tight text-muted-foreground">
          <span>
            {formatInt(totals.pixelPurchases)} {t.metric.pixelPurchases}
          </span>
          <Money value={totals.pixelValue} align="right" hideSecondary primaryClassName="text-xs font-normal" round />
        </span>
      ) : (
        <span className="text-subtle">—</span>
      );
  }
}

interface Sort {
  key: ColumnKey;
  desc: boolean;
}

function sortTree(nodes: TreeNode[], sort: Sort, currency: Currency): TreeNode[] {
  const col = COLUMNS.find((c) => c.key === sort.key)!;
  const value = (n: TreeNode) => sortValue(col, n.totals, deriveDual(n.totals)[currency]);
  return [...nodes]
    .sort((a, b) => {
      const va = value(a);
      const vb = value(b);
      if (va === null) return 1;
      if (vb === null) return -1;
      return sort.desc ? vb - va : va - vb;
    })
    .map((n) => ({ ...n, children: sortTree(n.children, sort, currency) }));
}

function Filters({ filter, onChange }: { filter: TreeFilter; onChange: (patch: Partial<TreeFilter>) => void }) {
  const { ds } = useApp();
  return (
    <>
      <Segmented
        value={filter.platform}
        onChange={(platform) => onChange({ platform: platform as Platform | "all" })}
        full
        className="md:inline-flex md:w-auto"
        options={[
          { value: "all", label: t.common.all },
          { value: "meta", label: t.platform.meta, icon: <PlatformIcon platform="meta" size="sm" /> },
          { value: "tiktok", label: t.platform.tiktok, icon: <PlatformIcon platform="tiktok" size="sm" /> },
        ]}
      />
      <Picker
        ariaLabel={t.campaigns.account}
        value={filter.accountId}
        onChange={(accountId) => onChange({ accountId })}
        className="md:w-56 md:data-[size=default]:h-10"
        options={[{ value: "all", label: t.campaigns.allAccounts }, ...ds.accounts.map((a) => ({ value: a.id, label: a.name }))]}
      />
      <Picker
        ariaLabel={t.campaigns.statusLabel}
        value={filter.status}
        onChange={(status) => onChange({ status: status as EntityStatus | "all" })}
        className="md:w-44 md:data-[size=default]:h-10"
        options={[
          { value: "all", label: t.campaigns.statusAll },
          { value: "active", label: t.campaigns.statusActive },
          { value: "paused", label: t.campaigns.statusPaused },
        ]}
      />
    </>
  );
}

function NodeName({ node, expanded }: { node: TreeNode; expanded: boolean }) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      {node.level !== "ad" ? (
        <ChevronRight className={cn("size-4 shrink-0 text-subtle transition-transform duration-200", expanded && "rotate-90")} />
      ) : (
        <span className="w-4 shrink-0" />
      )}
      {node.level === "campaign" && <PlatformIcon platform={node.platform} size="sm" />}
      <span className={cn("truncate", node.level === "campaign" ? "font-semibold" : node.level === "adset" ? "font-medium" : "text-muted-foreground")}>
        {node.name}
      </span>
    </span>
  );
}

export default function CampaignsPage() {
  const { ready, isEmpty, ds, analytics, currency } = useApp();
  const [filter, setFilter] = useState<TreeFilter>(DEFAULT_TREE_FILTER);
  const [visible, setVisible] = useState<ColumnKey[]>(DEFAULT_COLUMNS);
  const [sort, setSort] = useState<Sort>({ key: "spend", desc: true });
  const [expanded, setExpanded] = useState<Set<string>>(new Set(["c1"]));
  const [filtersOpen, setFiltersOpen] = useState(false);

  const tree = useMemo(
    () => sortTree(buildTree(ds, analytics.period.byAd, filter), sort, currency),
    [ds, analytics.period.byAd, filter, sort, currency],
  );
  const total = useMemo(() => tree.reduce((sum, n) => addTotals(sum, n.totals), emptyTotals()), [tree]);
  const columns = COLUMNS.filter((c) => visible.includes(c.key));
  const patch = (p: Partial<TreeFilter>) => setFilter((f) => ({ ...f, ...p }));

  if (!ready) return <PageSkeleton />;
  if (isEmpty) {
    return (
      <Surface>
        <EmptyState title={t.dashboard.emptyTitle} text={t.dashboard.emptyText} action={<Btn href="/onboarding">{t.dashboard.emptyAction}</Btn>} />
      </Surface>
    );
  }

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const allIds = tree.flatMap((c) => [c.id, ...c.children.map((a) => a.id)]);
  const allExpanded = allIds.length > 0 && allIds.every((id) => expanded.has(id));
  const onSort = (key: ColumnKey) => setSort((s) => ({ key, desc: s.key === key ? !s.desc : true }));
  const label = (key: ColumnKey) => t.metric[key];

  const rows: { node: TreeNode; depth: keyof typeof INDENT_PX }[] = [];
  for (const campaign of tree) {
    rows.push({ node: campaign, depth: "campaign" });
    if (!expanded.has(campaign.id)) continue;
    for (const adset of campaign.children) {
      rows.push({ node: adset, depth: "adset" });
      if (!expanded.has(adset.id)) continue;
      for (const ad of adset.children) rows.push({ node: ad, depth: "ad" });
    }
  }

  return (
    <div className="space-y-4">
      {/* Фильтры: строкой на десктопе, в bottom sheet на телефоне */}
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput
          placeholder={t.campaigns.searchPlaceholder}
          value={filter.query}
          onChange={(e) => patch({ query: e.target.value })}
          className="min-w-0 flex-1 md:max-w-xs [&_input]:md:h-10"
        />
        <div className="hidden items-center gap-2 md:flex">
          <Filters filter={filter} onChange={patch} />
        </div>
        <div className="md:hidden">
          <Pop
            open={filtersOpen}
            onOpenChange={setFiltersOpen}
            title={t.common.filters}
            trigger={
              <Btn variant="secondary" size="icon" aria-label={t.common.filters}>
                <SlidersHorizontal />
              </Btn>
            }
          >
            <div className="space-y-3">
              <Filters filter={filter} onChange={patch} />
              <Btn className="w-full" onClick={() => setFiltersOpen(false)}>
                {t.common.apply}
              </Btn>
            </div>
          </Pop>
        </div>
        <div className="ml-auto hidden items-center gap-2 md:flex">
          <Btn variant="ghost" size="sm" className="h-10" onClick={() => setExpanded(allExpanded ? new Set() : new Set(allIds))}>
            {allExpanded ? t.campaigns.collapseAll : t.campaigns.expandAll}
          </Btn>
          <DropdownMenu>
            <DropdownMenuTrigger className="inline-flex h-10 items-center gap-2 rounded-2xl border border-border bg-card px-3.5 text-sm font-medium shadow-card outline-none hover:shadow-lift focus-visible:ring-4 focus-visible:ring-brand/25">
              <Columns3 className="size-4 text-brand" />
              {t.campaigns.columns}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" sideOffset={8} className="max-h-96 w-56 rounded-2xl p-1.5">
              {COLUMNS.map((col) => (
                <DropdownMenuCheckboxItem
                  key={col.key}
                  checked={visible.includes(col.key)}
                  onSelect={(e) => e.preventDefault()}
                  onCheckedChange={(on) => setVisible((v) => (on ? [...v, col.key] : v.filter((k) => k !== col.key)))}
                  className="min-h-9 rounded-xl"
                >
                  {label(col.key)}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {!tree.length ? (
        <Surface>
          <EmptyState
            title={t.common.notFoundTitle}
            text={t.common.notFoundHint}
            action={
              <Btn variant="secondary" onClick={() => setFilter(DEFAULT_TREE_FILTER)}>
                {t.common.reset}
              </Btn>
            }
          />
        </Surface>
      ) : (
        <>
          {/* Десктоп и планшет: таблица-дерево с закреплённой первой колонкой */}
          <Surface className="hidden overflow-hidden md:block">
            <div className="overflow-x-auto">
              <table className="num w-full border-separate border-spacing-0 text-sm">
                <thead>
                  <tr className="text-xs text-muted-foreground">
                    <th className="sticky left-0 z-20 min-w-64 border-b border-border bg-card px-5 py-3.5 text-left font-medium xl:min-w-72">
                      {t.metric.name}
                    </th>
                    {columns.map((col) => {
                      const active = sort.key === col.key;
                      const Arrow = sort.desc ? ArrowDown : ArrowUp;
                      return (
                        <th key={col.key} className="border-b border-border px-3 py-2 text-right font-medium whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => onSort(col.key)}
                            title={col.key === "pixel" ? t.metric.pixelHint : undefined}
                            className={cn(
                              "inline-flex min-h-8 items-center gap-1 rounded-lg px-1.5 outline-none hover:text-foreground focus-visible:ring-4 focus-visible:ring-brand/25",
                              active && "text-foreground",
                            )}
                          >
                            {label(col.key)}
                            {active && <Arrow className="size-3.5 text-brand" />}
                          </button>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ node, depth }) => {
                    const dd = deriveDual(node.totals);
                    const isOpen = expanded.has(node.id);
                    const rowBg = depth === "campaign" ? "bg-card" : depth === "adset" ? "bg-[#FAFBFE]" : "bg-[#F7F8FC]";
                    return (
                      <motion.tr
                        key={node.id}
                        initial={depth === "campaign" ? false : { opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ duration: 0.2 }}
                        className={cn("group/row", rowBg)}
                      >
                        <td className={cn("sticky left-0 z-10 border-b border-border p-0 shadow-[6px_0_12px_-8px_rgba(16,24,40,0.12)]", rowBg)}>
                          <div className="flex items-center gap-2 pr-3" style={{ paddingLeft: 12 + INDENT_PX[depth] }}>
                            {node.level === "ad" ? (
                              <Link
                                href={`/creatives/${node.creativeId}`}
                                title={t.campaigns.openCreative}
                                className="flex min-h-13 min-w-0 flex-1 items-center gap-2 rounded-xl px-2 outline-none hover:text-brand focus-visible:ring-4 focus-visible:ring-brand/25"
                              >
                                <NodeName node={node} expanded={false} />
                              </Link>
                            ) : (
                              <button
                                type="button"
                                onClick={() => toggle(node.id)}
                                aria-expanded={isOpen}
                                className="flex min-h-13 min-w-0 flex-1 items-center gap-2 rounded-xl px-2 text-left outline-none focus-visible:ring-4 focus-visible:ring-brand/25"
                              >
                                <NodeName node={node} expanded={isOpen} />
                              </button>
                            )}
                            <StatusDot status={node.status} />
                          </div>
                        </td>
                        {columns.map((col) => (
                          <td key={col.key} className="border-b border-border px-3 py-2 text-right whitespace-nowrap">
                            <Cell col={col} totals={node.totals} dd={dd} currency={currency} />
                          </td>
                        ))}
                      </motion.tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="bg-muted/60 font-semibold">
                    <td className="sticky left-0 z-10 bg-[#F4F5FA] px-5 py-3.5 font-display text-[13px]">{t.common.total}</td>
                    {columns.map((col) => (
                      <td key={col.key} className="px-3 py-3 text-right whitespace-nowrap">
                        <Cell col={col} totals={total} dd={deriveDual(total)} currency={currency} />
                      </td>
                    ))}
                  </tr>
                </tfoot>
              </table>
            </div>
            <p className="border-t border-border px-5 py-3 text-xs text-subtle">{t.campaigns.romiLegend}</p>
          </Surface>

          {/* Телефон: таблица превращается в карточки */}
          <div className="space-y-3 md:hidden">
            {tree.map((campaign) => {
              const dd = deriveDual(campaign.totals);
              const open = expanded.has(campaign.id);
              return (
                <Surface key={campaign.id} className="overflow-hidden">
                  <button type="button" onClick={() => toggle(campaign.id)} aria-expanded={open} className="w-full p-4 text-left outline-none">
                    <div className="flex items-start gap-2.5">
                      <PlatformIcon platform={campaign.platform} />
                      <div className="min-w-0 flex-1">
                        <p className="text-[15px] leading-snug font-semibold">{campaign.name}</p>
                        <div className="mt-1 flex items-center gap-2">
                          <StatusDot status={campaign.status} label />
                          <span className="text-xs text-subtle">{t.campaigns.adsetsCount(campaign.children.length)}</span>
                        </div>
                      </div>
                      <ChevronRight className={cn("mt-1 size-5 shrink-0 text-subtle transition-transform", open && "rotate-90")} />
                    </div>
                    <dl className="num mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                      <div>
                        <dt className="text-xs text-muted-foreground">{t.metric.spend}</dt>
                        <dd className="mt-0.5">
                          <Money value={campaign.totals.spend} />
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs text-muted-foreground">{t.metric.revenue}</dt>
                        <dd className="mt-0.5">
                          <Money value={campaign.totals.revenue} />
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs text-muted-foreground">
                          {t.metric.leads} → {t.metric.sales}
                        </dt>
                        <dd className="mt-0.5 font-semibold">
                          {formatInt(campaign.totals.leads)} → {formatInt(campaign.totals.sales)}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs text-muted-foreground">{t.metric.romi}</dt>
                        <dd className="mt-1">
                          <RomiPill value={dd[currency].romi} />
                        </dd>
                      </div>
                    </dl>
                  </button>
                  <AnimatePresence initial={false}>
                    {open && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.25 }}
                        className="overflow-hidden"
                      >
                        <div className="space-y-3 border-t border-border bg-muted/40 p-3">
                          {campaign.children.map((adset) => (
                            <Fragment key={adset.id}>
                              <div className="flex items-center justify-between gap-2 px-1 pt-1">
                                <p className="min-w-0 truncate text-[13px] font-semibold">{adset.name}</p>
                                <RomiPill value={deriveDual(adset.totals)[currency].romi} />
                              </div>
                              <ul className="space-y-1.5">
                                {adset.children.map((ad) => (
                                  <li key={ad.id}>
                                    <Link
                                      href={`/creatives/${ad.creativeId}`}
                                      className="flex min-h-14 items-center gap-3 rounded-2xl bg-card px-3.5 py-2 active:bg-brand-soft"
                                    >
                                      <div className="min-w-0 flex-1">
                                        <p className="truncate text-sm font-medium">{ad.name}</p>
                                        <p className="num text-xs text-muted-foreground">
                                          {formatInt(ad.totals.leads)} → {formatInt(ad.totals.sales)}
                                        </p>
                                      </div>
                                      <Money value={ad.totals.spend} align="right" primaryClassName="text-sm" />
                                      <RomiPill value={deriveDual(ad.totals)[currency].romi} />
                                    </Link>
                                  </li>
                                ))}
                              </ul>
                            </Fragment>
                          ))}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </Surface>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
