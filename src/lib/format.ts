import type { Currency } from "./types";

const NBSP = " ";
export const CURRENCY_SYMBOL: Record<Currency, string> = { USD: "$", KZT: "₸" };
const FRACTION_DIGITS: Record<Currency, number> = { USD: 2, KZT: 0 };
const EM_DASH = "—";

/** Разделитель тысяч — пробел, дробная часть через точку: 1 240 500 / 1 240.50 */
export function formatNumber(value: number, digits = 0): string {
  if (!Number.isFinite(value)) return EM_DASH;
  const fixed = Math.abs(value).toFixed(digits);
  const [int, frac] = fixed.split(".");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
  const sign = value < 0 && Number(fixed) !== 0 ? "−" : "";
  return `${sign}${grouped}${frac ? `.${frac}` : ""}`;
}

interface MoneyOptions {
  /** Без копеек, даже для USD (крупные суммы, оси графиков). */
  round?: boolean;
}

/** `$1 240.50` и `632 655 ₸` */
export function formatMoney(value: number | null, currency: Currency, opts: MoneyOptions = {}): string {
  if (value === null || !Number.isFinite(value)) return EM_DASH;
  const digits = opts.round ? 0 : FRACTION_DIGITS[currency];
  const body = formatNumber(Math.abs(value), digits);
  const sign = value < 0 && Number(Math.abs(value).toFixed(digits)) !== 0 ? "−" : "";
  return currency === "USD" ? `${sign}$${body}` : `${sign}${body}${NBSP}₸`;
}

export function formatPercent(value: number | null, digits = 1): string {
  if (value === null || !Number.isFinite(value)) return EM_DASH;
  return `${formatNumber(value * 100, digits)}%`;
}

export function formatInt(value: number | null): string {
  return value === null ? EM_DASH : formatNumber(value, 0);
}

export function formatRatio(value: number | null, digits = 2): string {
  return value === null || !Number.isFinite(value) ? EM_DASH : `${formatNumber(value, digits)}×`;
}

/** Короткая запись для осей: 12 тыс, 1.2 млн */
export function formatCompact(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${formatNumber(value / 1_000_000, abs >= 10_000_000 ? 0 : 1)}${NBSP}млн`;
  if (abs >= 1_000) return `${formatNumber(value / 1_000, abs >= 10_000 ? 0 : 1)}${NBSP}тыс`;
  return formatNumber(value, 0);
}

export function formatCompactMoney(value: number, currency: Currency): string {
  const body = formatCompact(value);
  return currency === "USD" ? `$${body}` : `${body}${NBSP}₸`;
}
