import type { Aggregate } from "./analytics";
import { derive, emptyTotals, addTotals, type Totals } from "./metrics";
import type { Ad, Creative, Dual } from "./types";

/**
 * Рейтинг креатива 0–100 на основе ROMI, CAC, конверсии лид→продажа и CTR.
 * Байесовское сглаживание тянет креативы с малым объёмом данных к среднему по workspace,
 * чтобы креатив с 2 продажами не обгонял креатив со 100 продажами.
 */
export type CreativeBadge = "leader" | "growing" | "fatigue" | "burner" | "lowdata" | "stable";

export interface CreativeStat {
  creative: Creative;
  ad: Ad;
  totals: Totals;
  score: number;
  badge: CreativeBadge;
  parts: { romi: number; cac: number; cr: number; ctr: number };
}

const WEIGHTS = { romi: 0.45, cac: 0.2, cr: 0.2, ctr: 0.15 } as const;
/** «Виртуальные» наблюдения, которыми разбавляем факт. */
const PRIOR_LEADS = 15;
const PRIOR_IMPRESSIONS = 5000;
/** Доля целевого CAC, при расходе в которую ROMI креатива весит столько же, сколько среднее. */
const PRIOR_SPEND_IN_TARGET_CAC = 1.5;

const LOW_DATA_SPEND_IN_TARGET_CAC = 0.5;
const LOW_DATA_LEADS = 5;
const BURNER_SPEND_IN_TARGET_CAC = 2;
const FATIGUE_FREQUENCY = 3;
const FATIGUE_CTR_DROP = 0.8;
const LEADER_SCORE = 70;
const LEADER_MIN_SALES = 3;
const GROWING_SCORE = 52;
const SCORE_CURRENCY = "USD" as const;

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

interface ScoreInput {
  ads: Ad[];
  creatives: Creative[];
  period: Aggregate;
  /** Последние 7 дней периода и 7 дней до них — для трендов. */
  recent: Aggregate;
  prior: Aggregate;
  targetCac: Dual;
  /** Доля: 1 = 100% */
  targetRomi: number;
}

export function scoreCreatives({ ads, creatives, period, recent, prior, targetCac, targetRomi }: ScoreInput): CreativeStat[] {
  const base = derive(period.total, SCORE_CURRENCY);
  const baseCr = base.cr ?? 0.2;
  const baseCtr = base.ctr ?? 0.015;
  const baseRomi = base.romi ?? 0;
  const target = Math.max(targetCac[SCORE_CURRENCY], 1);

  const sumFor = (agg: Aggregate, adIds: string[]) =>
    adIds.reduce((sum, id) => addTotals(sum, agg.byAd.get(id) ?? emptyTotals()), emptyTotals());

  return creatives.map((creative) => {
    const creativeAds = ads.filter((a) => a.creativeId === creative.id);
    const adIds = creativeAds.map((a) => a.id);
    const totals = sumFor(period, adIds);
    const d = derive(totals, SCORE_CURRENCY);
    const r = derive(sumFor(recent, adIds), SCORE_CURRENCY);
    const p = derive(sumFor(prior, adIds), SCORE_CURRENCY);
    const recentTotals = sumFor(recent, adIds);
    const priorTotals = sumFor(prior, adIds);

    const crSmooth = (totals.sales + PRIOR_LEADS * baseCr) / (totals.leads + PRIOR_LEADS);
    const ctrSmooth = (totals.clicks + PRIOR_IMPRESSIONS * baseCtr) / (totals.impressions + PRIOR_IMPRESSIONS);
    const spendWeight = d.spend / (d.spend + PRIOR_SPEND_IN_TARGET_CAC * target);
    const romiSmooth = spendWeight * (d.romi ?? -1) + (1 - spendWeight) * baseRomi;
    const cacSmooth = d.spend / (Math.max(totals.leads, 1) * crSmooth);

    const parts = {
      romi: sigmoid((romiSmooth - targetRomi) * 1.2),
      cac: 1 / (1 + (cacSmooth / target) ** 2),
      cr: clamp01(crSmooth / (2 * baseCr || 1)),
      ctr: clamp01(ctrSmooth / (2 * baseCtr || 1)),
    };
    const score = Math.round(
      100 * (WEIGHTS.romi * parts.romi + WEIGHTS.cac * parts.cac + WEIGHTS.cr * parts.cr + WEIGHTS.ctr * parts.ctr),
    );

    let badge: CreativeBadge = "stable";
    const isFatigued =
      (r.frequency ?? 0) > FATIGUE_FREQUENCY && r.ctr !== null && p.ctr !== null && r.ctr < p.ctr * FATIGUE_CTR_DROP;
    if (d.spend < LOW_DATA_SPEND_IN_TARGET_CAC * target && totals.leads < LOW_DATA_LEADS) badge = "lowdata";
    else if (totals.sales === 0 && d.spend > BURNER_SPEND_IN_TARGET_CAC * target) badge = "burner";
    else if (isFatigued) badge = "fatigue";
    else if (score >= LEADER_SCORE && totals.sales >= LEADER_MIN_SALES) badge = "leader";
    else if (score >= GROWING_SCORE && recentTotals.sales > priorTotals.sales) badge = "growing";

    return { creative, ad: creativeAds[0], totals, score, badge, parts };
  });
}
