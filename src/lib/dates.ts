import { APP } from "./config";
import type { DateRange } from "./types";

const DAY_MS = 86_400_000;

/** Все «дни» в приложении — строки yyyy-MM-dd; арифметика идёт в UTC, чтобы не ловить сдвиги. */
const toUtc = (iso: string) => new Date(`${iso}T00:00:00Z`);
const toIso = (d: Date) => d.toISOString().slice(0, 10);

export function todayISO(timeZone: string = APP.timezone): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date());
}

export function addDays(iso: string, n: number): string {
  return toIso(new Date(toUtc(iso).getTime() + n * DAY_MS));
}

export function diffDays(a: string, b: string): number {
  return Math.round((toUtc(a).getTime() - toUtc(b).getTime()) / DAY_MS);
}

export function eachDay({ from, to }: DateRange): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

export function weekday(iso: string): number {
  return toUtc(iso).getUTCDay();
}

export const inRange = (iso: string, r: DateRange) => iso >= r.from && iso <= r.to;
export const rangeLength = (r: DateRange) => diffDays(r.to, r.from) + 1;

export type PeriodPreset = "today" | "yesterday" | "7d" | "14d" | "30d" | "month" | "custom";
export const PERIOD_PRESETS: PeriodPreset[] = ["today", "yesterday", "7d", "14d", "30d", "month", "custom"];

const PRESET_DAYS: Partial<Record<PeriodPreset, number>> = { "7d": 7, "14d": 14, "30d": 30 };

export function resolvePeriod(preset: PeriodPreset, today: string, custom?: DateRange): DateRange {
  if (preset === "today") return { from: today, to: today };
  if (preset === "yesterday") return { from: addDays(today, -1), to: addDays(today, -1) };
  if (preset === "month") return { from: `${today.slice(0, 8)}01`, to: today };
  if (preset === "custom" && custom) return custom;
  const days = PRESET_DAYS[preset] ?? 30;
  return { from: addDays(today, -(days - 1)), to: today };
}

/** Предыдущий период той же длины, сразу перед текущим. */
export function previousPeriod(r: DateRange): DateRange {
  const len = rangeLength(r);
  return { from: addDays(r.from, -len), to: addDays(r.from, -1) };
}

const fmtShort = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", timeZone: "UTC" });
const fmtFull = new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" });
const fmtLong = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", timeZone: "UTC" });

/** «12 окт» */
export const formatDayShort = (iso: string) => fmtShort.format(toUtc(iso)).replace(".", "");
/** «12.10.2026» */
export const formatDate = (iso: string) => fmtFull.format(toUtc(iso));
/** «12 октября» */
export const formatDayLong = (iso: string) => fmtLong.format(toUtc(iso));

export function formatRange(r: DateRange): string {
  return r.from === r.to ? formatDayShort(r.from) : `${formatDayShort(r.from)} – ${formatDayShort(r.to)}`;
}
