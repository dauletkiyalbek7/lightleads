import type { Attribution } from "./attribution";
import { addDual, toDual, zeroDual } from "./currency";
import { eachDay, inRange } from "./dates";
import { addTotals, emptyTotals, type Totals } from "./metrics";
import type { Ad, Dataset, DateRange, Dual, EntityStatus, Platform, Sale } from "./types";

export interface DayPoint {
  date: string;
  spend: Dual;
  revenue: Dual;
  cogs: Dual;
  leads: number;
  sales: number;
}

export interface Aggregate {
  range: DateRange;
  total: Totals;
  byAd: Map<string, Totals>;
  daily: DayPoint[];
  /** Продажи без источника — метрика качества данных. */
  unattributed: { count: number; revenue: Dual };
}

interface AggregateOptions {
  /** Ограничить расчёт набором объявлений (фильтр по платформе/аккаунту или страница креатива). */
  adIds?: Set<string>;
}

export function saleMoney(sale: Sale, rates: Dataset["rates"]): { revenue: Dual; cogs: Dual } {
  return {
    revenue: toDual(sale.amount, sale.currency, sale.date, rates),
    cogs: toDual(sale.cost, sale.currency, sale.date, rates),
  };
}

/** Сводит расход, лиды и продажи за период. Все суммы конвертируются по курсу на дату операции. */
export function aggregate(
  ds: Dataset,
  sales: Sale[],
  attributions: Map<string, Attribution>,
  range: DateRange,
  opts: AggregateOptions = {},
): Aggregate {
  const { adIds } = opts;
  const total = emptyTotals();
  const byAd = new Map<string, Totals>();
  const days = new Map<string, DayPoint>(
    eachDay(range).map((date) => [date, { date, spend: zeroDual(), revenue: zeroDual(), cogs: zeroDual(), leads: 0, sales: 0 }]),
  );
  const unattributed = { count: 0, revenue: zeroDual() };

  const adTotals = (adId: string): Totals => {
    let t = byAd.get(adId);
    if (!t) byAd.set(adId, (t = emptyTotals()));
    return t;
  };
  const allowed = (adId: string | null) => !adIds || (adId !== null && adIds.has(adId));

  for (const row of ds.insights) {
    if (!inRange(row.date, range) || !allowed(row.adId)) continue;
    const part = emptyTotals();
    part.spend = toDual(row.spend, row.currency, row.date, ds.rates);
    part.pixelValue = toDual(row.pixelValue, row.currency, row.date, ds.rates);
    part.impressions = row.impressions;
    part.reach = row.reach;
    part.clicks = row.clicks;
    part.pixelPurchases = row.pixelPurchases;
    part.adLeads = row.platformLeads + row.messagingStarted;
    part.videoPlays = row.videoPlays;
    part.video3s = row.video3s;
    part.videoHold = row.videoHold;
    part.videoWatchSec = row.videoWatchSec;
    addTotals(adTotals(row.adId), part);
    addTotals(total, part);
    addDual(days.get(row.date)!.spend, part.spend);
  }

  for (const lead of ds.leads) {
    if (!inRange(lead.date, range) || !allowed(lead.adId)) continue;
    total.leads++;
    days.get(lead.date)!.leads++;
    if (lead.adId) adTotals(lead.adId).leads++;
  }

  for (const sale of sales) {
    if (!inRange(sale.date, range)) continue;
    const adId = attributions.get(sale.id)?.adId ?? null;
    if (!allowed(adId)) continue;
    const { revenue, cogs } = saleMoney(sale, ds.rates);
    total.sales++;
    addDual(total.revenue, revenue);
    addDual(total.cogs, cogs);
    const day = days.get(sale.date)!;
    day.sales++;
    addDual(day.revenue, revenue);
    addDual(day.cogs, cogs);
    if (adId) {
      const t = adTotals(adId);
      t.sales++;
      addDual(t.revenue, revenue);
      addDual(t.cogs, cogs);
    } else {
      unattributed.count++;
      addDual(unattributed.revenue, revenue);
    }
  }

  return { range, total, byAd, daily: [...days.values()], unattributed };
}

export type TreeLevel = "campaign" | "adset" | "ad";

export interface TreeNode {
  id: string;
  level: TreeLevel;
  name: string;
  status: EntityStatus;
  platform: Platform;
  accountId: string;
  creativeId: string | null;
  totals: Totals;
  children: TreeNode[];
}

export interface TreeFilter {
  platform: Platform | "all";
  accountId: string | "all";
  status: EntityStatus | "all";
  query: string;
}

export const DEFAULT_TREE_FILTER: TreeFilter = { platform: "all", accountId: "all", status: "all", query: "" };

/** Дерево Кампания → Группа → Объявление с суммами на каждом уровне. */
export function buildTree(ds: Dataset, byAd: Map<string, Totals>, filter: TreeFilter): TreeNode[] {
  const query = filter.query.trim().toLowerCase();
  const adsByAdset = new Map<string, Ad[]>();
  for (const ad of ds.ads) {
    const list = adsByAdset.get(ad.adsetId);
    if (list) list.push(ad);
    else adsByAdset.set(ad.adsetId, [ad]);
  }

  const tree: TreeNode[] = [];
  for (const campaign of ds.campaigns) {
    if (filter.platform !== "all" && campaign.platform !== filter.platform) continue;
    if (filter.accountId !== "all" && campaign.accountId !== filter.accountId) continue;
    if (filter.status !== "all" && campaign.status !== filter.status) continue;
    const campaignMatches = !query || campaign.name.toLowerCase().includes(query);

    const adsetNodes: TreeNode[] = [];
    for (const adset of ds.adsets.filter((a) => a.campaignId === campaign.id)) {
      const adsetMatches = campaignMatches || adset.name.toLowerCase().includes(query);
      const adNodes: TreeNode[] = (adsByAdset.get(adset.id) ?? [])
        .filter((ad) => adsetMatches || ad.name.toLowerCase().includes(query))
        .map((ad) => ({
          id: ad.id,
          level: "ad" as const,
          name: ad.name,
          status: ad.status,
          platform: ad.platform,
          accountId: ad.accountId,
          creativeId: ad.creativeId,
          totals: byAd.get(ad.id) ?? emptyTotals(),
          children: [],
        }));
      if (!adNodes.length) continue;
      adsetNodes.push({
        id: adset.id,
        level: "adset",
        name: adset.name,
        status: adset.status,
        platform: campaign.platform,
        accountId: campaign.accountId,
        creativeId: null,
        totals: adNodes.reduce((sum, n) => addTotals(sum, n.totals), emptyTotals()),
        children: adNodes,
      });
    }
    if (!adsetNodes.length) continue;
    tree.push({
      id: campaign.id,
      level: "campaign",
      name: campaign.name,
      status: campaign.status,
      platform: campaign.platform,
      accountId: campaign.accountId,
      creativeId: null,
      totals: adsetNodes.reduce((sum, n) => addTotals(sum, n.totals), emptyTotals()),
      children: adsetNodes,
    });
  }
  return tree;
}
