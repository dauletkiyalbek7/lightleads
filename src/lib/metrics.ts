import { addDual, zeroDual } from "./currency";
import type { Currency, Dual } from "./types";

/**
 * Единственное место, где считаются производные метрики
 * (прибыль, ROAS, ROMI, CPL, CAC, конверсия...). Не дублировать в компонентах.
 */
export interface Totals {
  spend: Dual;
  revenue: Dual;
  cogs: Dual;
  pixelValue: Dual;
  impressions: number;
  reach: number;
  clicks: number;
  leads: number;
  sales: number;
  pixelPurchases: number;
  videoPlays: number;
  video3s: number;
  videoHold: number;
  videoWatchSec: number;
}

export const emptyTotals = (): Totals => ({
  spend: zeroDual(),
  revenue: zeroDual(),
  cogs: zeroDual(),
  pixelValue: zeroDual(),
  impressions: 0,
  reach: 0,
  clicks: 0,
  leads: 0,
  sales: 0,
  pixelPurchases: 0,
  videoPlays: 0,
  video3s: 0,
  videoHold: 0,
  videoWatchSec: 0,
});

const COUNT_KEYS = [
  "impressions",
  "reach",
  "clicks",
  "leads",
  "sales",
  "pixelPurchases",
  "videoPlays",
  "video3s",
  "videoHold",
  "videoWatchSec",
] as const;
const MONEY_KEYS = ["spend", "revenue", "cogs", "pixelValue"] as const;

export function addTotals(target: Totals, value: Totals): Totals {
  for (const k of MONEY_KEYS) addDual(target[k], value[k]);
  for (const k of COUNT_KEYS) target[k] += value[k];
  return target;
}

export function sumTotals(list: Totals[]): Totals {
  return list.reduce(addTotals, emptyTotals());
}

const ratio = (a: number, b: number): number | null => (b > 0 ? a / b : null);

export interface Derived {
  spend: number;
  revenue: number;
  cogs: number;
  /** Прибыль = Выручка − Себестоимость − Расход на рекламу */
  profit: number;
  pixelValue: number;
  cpm: number | null;
  ctr: number | null;
  cpc: number | null;
  frequency: number | null;
  /** Стоимость лида */
  cpl: number | null;
  /** Конверсия лид → продажа */
  cr: number | null;
  /** Стоимость продажи */
  cac: number | null;
  /** Средний чек */
  aov: number | null;
  /** Выручка / расход */
  roas: number | null;
  /** Прибыль / расход (доля; ×100 = %) */
  romi: number | null;
  /** Просмотры 3с / показы */
  hookRate: number | null;
  /** Досмотры / просмотры 3с */
  holdRate: number | null;
  avgWatchSec: number | null;
}

const IMPRESSIONS_PER_MILLE = 1000;

export function derive(t: Totals, currency: Currency): Derived {
  const spend = t.spend[currency];
  const revenue = t.revenue[currency];
  const cogs = t.cogs[currency];
  const profit = revenue - cogs - spend;
  return {
    spend,
    revenue,
    cogs,
    profit,
    pixelValue: t.pixelValue[currency],
    cpm: ratio(spend * IMPRESSIONS_PER_MILLE, t.impressions),
    ctr: ratio(t.clicks, t.impressions),
    cpc: ratio(spend, t.clicks),
    frequency: ratio(t.impressions, t.reach),
    cpl: ratio(spend, t.leads),
    cr: ratio(t.sales, t.leads),
    cac: ratio(spend, t.sales),
    aov: ratio(revenue, t.sales),
    roas: ratio(revenue, spend),
    romi: ratio(profit, spend),
    hookRate: ratio(t.video3s, t.impressions),
    holdRate: ratio(t.videoHold, t.video3s),
    avgWatchSec: ratio(t.videoWatchSec, t.videoPlays),
  };
}

export type DerivedDual = Record<Currency, Derived>;
export const deriveDual = (t: Totals): DerivedDual => ({ USD: derive(t, "USD"), KZT: derive(t, "KZT") });

/** Относительное изменение к прошлому периоду (доля). null, если сравнивать не с чем. */
export function delta(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null || previous === 0) return null;
  return (current - previous) / Math.abs(previous);
}
