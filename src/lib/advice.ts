import { t } from "@/i18n";
import { formatMoney, formatNumber, formatPercent } from "./format";
import type { Signal } from "./rules";
import type { Currency, Dual } from "./types";

export interface Advice {
  signal: Signal;
  title: string;
  what: string;
  why: string;
  action: string;
}

const FREQUENCY_DIGITS = 1;

/**
 * Превращает сигнал правил в понятный текст. В демо — шаблоны из словаря;
 * в Фазе 7 этот же интерфейс вернёт ответ Claude (строго JSON по zod-схеме).
 */
export function buildAdvice(signal: Signal, currency: Currency): Advice {
  const { facts } = signal;
  const money = (v?: Dual) => formatMoney(v ? v[currency] : null, currency, { round: true });
  const pct = (v?: number, digits = 0) => formatPercent(v ?? null, digits);

  const params = {
    name: signal.entityName,
    spend: money(facts.spend),
    target: money(facts.targetCac),
    cac: money(facts.cac),
    romi: pct(facts.romi),
    targetRomi: pct(facts.targetRomi),
    frequency: formatNumber(facts.frequency ?? 0, FREQUENCY_DIGITS),
    drop: pct(facts.ctrDrop),
    leads: facts.leads ?? 0,
    sales: facts.sales ?? 0,
    cr: pct(facts.cr, 1),
    avgCr: pct(facts.avgCr, 1),
    share: pct(facts.share),
    count: facts.count ?? 0,
  };
  const template = t.ai.signals[signal.kind];
  return {
    signal,
    title: template.title(params),
    what: template.what(params),
    why: template.why(),
    action: template.action(),
  };
}
