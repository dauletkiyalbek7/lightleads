import type { Aggregate } from "./analytics";
import { derive } from "./metrics";
import type { CreativeStat } from "./score";
import type { Dataset, Dual } from "./types";

/**
 * Детерминированные правила находят сигналы. В Фазе 7 сигналы + агрегаты
 * (без телефонов и персональных данных) уходят в Claude API, который пишет текст совета.
 * В демо текст собирается из шаблонов i18n.
 */
export type SignalKind = "burner" | "scale" | "fatigue" | "lead_quality" | "unattributed";
export type Priority = "high" | "medium" | "low";

export interface Signal {
  id: string;
  kind: SignalKind;
  priority: Priority;
  entityName: string;
  href: string;
  facts: {
    spend?: Dual;
    cac?: Dual;
    targetCac?: Dual;
    romi?: number;
    targetRomi?: number;
    frequency?: number;
    ctrDrop?: number;
    leads?: number;
    sales?: number;
    cr?: number;
    avgCr?: number;
    share?: number;
    count?: number;
  };
}

const MAX_PER_KIND = 2;
const SCALE_MIN_SALES = 3;
const LEAD_QUALITY_MIN_LEADS = 15;
const LEAD_QUALITY_CR_RATIO = 0.6;
const UNATTRIBUTED_SHARE_MEDIUM = 0.05;
const UNATTRIBUTED_SHARE_HIGH = 0.2;
const PRIORITY_ORDER: Record<Priority, number> = { high: 0, medium: 1, low: 2 };

interface RulesInput {
  ds: Dataset;
  period: Aggregate;
  recent: Aggregate;
  prior: Aggregate;
  stats: CreativeStat[];
  targetCac: Dual;
  targetRomi: number;
}

export function detectSignals({ ds, period, recent, prior, stats, targetCac, targetRomi }: RulesInput): Signal[] {
  const signals: Signal[] = [];
  const bySpend = [...stats].sort((a, b) => b.totals.spend.USD - a.totals.spend.USD);
  const creativeHref = (id: string) => `/creatives/${id}`;

  // 1. Расход > 2× целевого CAC и 0 продаж → отключить или переработать
  for (const s of bySpend.filter((s) => s.badge === "burner").slice(0, MAX_PER_KIND)) {
    signals.push({
      id: `burner_${s.creative.id}`,
      kind: "burner",
      priority: "high",
      entityName: s.creative.name,
      href: creativeHref(s.creative.id),
      facts: { spend: s.totals.spend, targetCac, leads: s.totals.leads, sales: 0 },
    });
  }

  // 2. ROMI выше цели за период и за последние 7 дней → масштабировать бюджет
  const scalable = stats
    .filter((s) => {
      const all = derive(s.totals, "USD").romi;
      const last = derive(recent.byAd.get(s.ad.id) ?? s.totals, "USD").romi;
      return s.ad.status === "active" && s.totals.sales >= SCALE_MIN_SALES && all !== null && all > targetRomi && last !== null && last > targetRomi;
    })
    .sort((a, b) => b.score - a.score);
  for (const s of scalable.slice(0, MAX_PER_KIND)) {
    const d = { USD: derive(s.totals, "USD"), KZT: derive(s.totals, "KZT") };
    signals.push({
      id: `scale_${s.creative.id}`,
      kind: "scale",
      priority: "medium",
      entityName: s.creative.name,
      href: creativeHref(s.creative.id),
      facts: {
        romi: d.USD.romi ?? 0,
        targetRomi,
        sales: s.totals.sales,
        cac: { USD: d.USD.cac ?? 0, KZT: d.KZT.cac ?? 0 },
        targetCac,
      },
    });
  }

  // 3. Frequency > 3 и CTR падает → креатив выгорает
  for (const s of bySpend.filter((s) => s.badge === "fatigue").slice(0, MAX_PER_KIND)) {
    const r = derive(recent.byAd.get(s.ad.id) ?? s.totals, "USD");
    const p = derive(prior.byAd.get(s.ad.id) ?? s.totals, "USD");
    signals.push({
      id: `fatigue_${s.creative.id}`,
      kind: "fatigue",
      priority: "medium",
      entityName: s.creative.name,
      href: creativeHref(s.creative.id),
      facts: { frequency: r.frequency ?? 0, ctrDrop: r.ctr !== null && p.ctr ? 1 - r.ctr / p.ctr : 0, spend: s.totals.spend },
    });
  }

  // 4. Много лидов, мало продаж → качество лидов или обработка отделом продаж
  const avgCr = derive(period.total, "USD").cr ?? 0;
  const weakCampaigns = ds.campaigns
    .map((campaign) => {
      let leads = 0;
      let sales = 0;
      for (const ad of ds.ads) {
        if (ad.campaignId !== campaign.id) continue;
        const t = period.byAd.get(ad.id);
        leads += t?.leads ?? 0;
        sales += t?.sales ?? 0;
      }
      return { campaign, leads, sales, cr: leads ? sales / leads : 0 };
    })
    .filter((c) => c.leads >= LEAD_QUALITY_MIN_LEADS && c.cr < avgCr * LEAD_QUALITY_CR_RATIO)
    .sort((a, b) => b.leads - a.leads);
  for (const c of weakCampaigns.slice(0, 1)) {
    signals.push({
      id: `quality_${c.campaign.id}`,
      kind: "lead_quality",
      priority: "medium",
      entityName: c.campaign.name,
      href: "/campaigns",
      facts: { leads: c.leads, sales: c.sales, cr: c.cr, avgCr },
    });
  }

  // 5. Много продаж без источника → проверить UTM / подключить лид-формы
  const share = period.total.sales ? period.unattributed.count / period.total.sales : 0;
  if (share >= UNATTRIBUTED_SHARE_MEDIUM) {
    signals.push({
      id: "unattributed",
      kind: "unattributed",
      priority: share >= UNATTRIBUTED_SHARE_HIGH ? "high" : "low",
      entityName: "",
      href: "/sales?filter=unattributed",
      facts: { share, count: period.unattributed.count, sales: period.total.sales },
    });
  }

  return signals.sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]);
}

/** Пока цели не заданы, предлагаем их по историческим данным. */
export function suggestTargets(total: Aggregate["total"]): { cacKzt: number; romiPct: number } {
  const d = derive(total, "KZT");
  const CAC_STEP = 500;
  const ROMI_STEP = 10;
  return {
    cacKzt: Math.round((d.cac ?? 15000) / CAC_STEP) * CAC_STEP,
    romiPct: Math.max(ROMI_STEP, Math.round(((d.romi ?? 1) * 100) / ROMI_STEP) * ROMI_STEP),
  };
}
