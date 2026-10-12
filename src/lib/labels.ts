import { plural, t } from "@/i18n";

const MINUTE_MS = 60_000;
const MINUTES_IN_HOUR = 60;

/** 0 → «сегодня», 1 → «вчера», 5 → «5 дней назад» */
export function agoLabel(days: number): string {
  if (days <= 0) return t.common.today;
  if (days === 1) return t.common.yesterday;
  return t.common.ago(days, plural(days, t.common.dayForms));
}

/** «12 минут назад» / «только что» */
export function sinceLabel(timestamp: number, now: number = Date.now()): string {
  const minutes = Math.max(0, Math.floor((now - timestamp) / MINUTE_MS));
  if (minutes < 1) return t.sync.justNow;
  if (minutes < MINUTES_IN_HOUR) return t.common.ago(minutes, plural(minutes, t.common.minuteForms));
  return t.common.ago(Math.floor(minutes / MINUTES_IN_HOUR), "ч");
}
