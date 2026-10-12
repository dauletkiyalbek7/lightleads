import { addDays } from "./dates";
import type { Currency, Dual } from "./types";

const MAX_LOOKBACK_DAYS = 14;

export const zeroDual = (): Dual => ({ USD: 0, KZT: 0 });
export const otherCurrency = (c: Currency): Currency => (c === "USD" ? "KZT" : "USD");

/** Курс НБРК на дату. В выходные и праздники курса нет — берём последний известный. */
export function rateOn(rates: Record<string, number>, date: string): { rate: number; date: string } {
  let d = date;
  for (let i = 0; i <= MAX_LOOKBACK_DAYS; i++) {
    const rate = rates[d];
    if (rate) return { rate, date: d };
    d = addDays(d, -1);
  }
  const known = Object.keys(rates).sort();
  const last = known.filter((k) => k <= date).pop() ?? known[0];
  return { rate: rates[last] ?? 1, date: last ?? date };
}

/** Конвертация по курсу на дату расхода/продажи, а не по сегодняшнему. */
export function toDual(amount: number, currency: Currency, date: string, rates: Record<string, number>): Dual {
  const { rate } = rateOn(rates, date);
  return currency === "USD" ? { USD: amount, KZT: amount * rate } : { USD: amount / rate, KZT: amount };
}

export function addDual(target: Dual, value: Dual): Dual {
  target.USD += value.USD;
  target.KZT += value.KZT;
  return target;
}
