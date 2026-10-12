import { t } from "@/i18n";
import type { Aggregate } from "./analytics";
import { formatMoney, formatPercent } from "./format";
import { addTotals, derive, emptyTotals } from "./metrics";
import type { CreativeStat } from "./score";
import type { Currency, Dataset, Dual, Platform } from "./types";

/**
 * Демо-версия чата. Каждый ответ считается «безопасной агрегирующей функцией» по данным workspace —
 * в Фазе 7 эти же функции станут инструментами (tool use) для Claude, без прямого SQL от модели.
 */
export type QuestionKind = keyof typeof t.ai.chat.suggestions;
export const QUESTION_KINDS = Object.keys(t.ai.chat.suggestions) as QuestionKind[];

const KEYWORDS: [QuestionKind, RegExp][] = [
  ["waste", /теря|слив|убыт|впуст/i],
  ["platforms", /meta|мета|tiktok|тикток|платформ|facebook|инст/i],
  ["unattributed", /источник|без источ|не определ/i],
  ["summary", /сводк|итог|в целом|кратк/i],
  ["best", /прибыл|лучш|топ|эффектив|креатив/i],
];

export function classifyQuestion(text: string): QuestionKind | null {
  return KEYWORDS.find(([, re]) => re.test(text))?.[0] ?? null;
}

interface ChatContext {
  ds: Dataset;
  period: Aggregate;
  stats: CreativeStat[];
  currency: Currency;
}

export function answerQuestion(kind: QuestionKind | null, { ds, period, stats, currency }: ChatContext): string {
  const a = t.ai.chat.answers;
  const money = (v: number | Dual) => formatMoney(typeof v === "number" ? v : v[currency], currency, { round: true });
  const pct = (v: number | null) => formatPercent(v, 0);

  switch (kind) {
    case "best": {
      const best = stats
        .filter((s) => s.totals.sales > 0)
        .map((s) => ({ s, d: derive(s.totals, currency) }))
        .sort((x, y) => y.d.profit - x.d.profit)[0];
      if (!best) return a.bestNone;
      return a.best({ name: best.s.creative.name, profit: money(best.d.profit), romi: pct(best.d.romi), sales: best.s.totals.sales, spend: money(best.d.spend) });
    }
    case "waste": {
      const wasted = stats.filter((s) => s.totals.sales === 0 && s.totals.spend[currency] > 0).sort((x, y) => y.totals.spend[currency] - x.totals.spend[currency]);
      if (!wasted.length) return a.wasteNone;
      const total = wasted.reduce((sum, s) => sum + s.totals.spend[currency], 0);
      return a.waste({ name: wasted[0].creative.name, spend: money(wasted[0].totals.spend), total: money(total), count: wasted.length });
    }
    case "platforms": {
      const byPlatform = (platform: Platform) => {
        const totals = emptyTotals();
        for (const ad of ds.ads) if (ad.platform === platform) addTotals(totals, period.byAd.get(ad.id) ?? emptyTotals());
        return { totals, d: derive(totals, currency) };
      };
      const meta = byPlatform("meta");
      const tiktok = byPlatform("tiktok");
      return a.platforms({
        metaSpend: money(meta.d.spend),
        metaSales: meta.totals.sales,
        metaRomi: pct(meta.d.romi),
        ttSpend: money(tiktok.d.spend),
        ttSales: tiktok.totals.sales,
        ttRomi: pct(tiktok.d.romi),
        winner: (meta.d.romi ?? -1) >= (tiktok.d.romi ?? -1) ? t.platform.meta : t.platform.tiktok,
      });
    }
    case "unattributed":
      return a.unattributed({
        count: period.unattributed.count,
        sales: period.total.sales,
        share: pct(period.total.sales ? period.unattributed.count / period.total.sales : 0),
        revenue: money(period.unattributed.revenue),
      });
    case "summary": {
      const d = derive(period.total, currency);
      return a.summary({ spend: money(d.spend), leads: period.total.leads, sales: period.total.sales, revenue: money(d.revenue), profit: money(d.profit), romi: pct(d.romi) });
    }
    default:
      return a.fallback;
  }
}
