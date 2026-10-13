import { t } from "@/i18n";
import { addDays } from "./dates";
import { SUPABASE_URL } from "./supabase/env";
import { callFunction, type FnResult } from "./supabase/functions";
import type { Platform } from "./types";

/**
 * Запросы к Edge Functions подключения рекламы (supabase/functions/meta-oauth, tiktok-oauth):
 * вход на платформе, выбор кабинетов и синхронизация. У обеих функций одинаковые действия.
 */
const FUNCTIONS: Record<Platform, string> = { meta: "meta-oauth", tiktok: "tiktok-oauth" };
export const AD_PLATFORMS: Platform[] = ["meta", "tiktok"];

/** Первая загрузка: глубина истории и размер одного запроса статистики, дней. */
export const INITIAL_SYNC_DAYS = 90;
const INSIGHTS_WINDOW_DAYS = 10;
/** Обычное обновление перечитывает последние дни: платформы пересчитывают статистику задним числом. */
export const REFRESH_SYNC_DAYS = 3;
/** Страховка от бесконечного цикла, если превью не скачиваются. */
const MAX_THUMBNAIL_STEPS = 40;

export interface AdAccountOption {
  externalId: string;
  name: string;
  currency: string;
  timezone: string;
  active: boolean;
  /** false — валюта кабинета не USD и не KZT, подключить пока нельзя. */
  supported: boolean;
  selected: boolean;
}

export interface SyncAccount {
  id: string;
  name: string;
}

/** Заданы ли на сервере ключи приложения платформы. Пока нет, подключение недоступно. */
export async function adsConfigured(platform: Platform): Promise<boolean> {
  try {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/${FUNCTIONS[platform]}`);
    const payload = (await response.json()) as { configured?: boolean };
    return payload.configured === true;
  } catch {
    return false;
  }
}

/** Текст ошибки для пользователя: наш перевод кода, иначе пояснение самой платформы. */
export function adErrorText(platform: Platform, result: { error: string; detail?: string }): string {
  const s = t.ads[platform];
  const known: Record<string, string> = { not_configured: s.notConfigured, token_expired: s.tokenExpired, not_connected: s.notConnected };
  const fallback: Record<string, string> = { platform_error: s.platformError, ...t.ads.errors };
  return known[result.error] ?? result.detail ?? fallback[result.error] ?? t.common.genericError;
}

export const adsStart = (platform: Platform, workspaceId: string) =>
  callFunction<{ url: string }>(FUNCTIONS[platform], { action: "start", workspaceId, origin: window.location.origin });

export const adsAccounts = (platform: Platform, workspaceId: string) =>
  callFunction<{ accounts: AdAccountOption[] }>(FUNCTIONS[platform], { action: "accounts", workspaceId });

export const adsSelectAccounts = (platform: Platform, workspaceId: string, accounts: string[]) =>
  callFunction<{ accounts: SyncAccount[] }>(FUNCTIONS[platform], { action: "select_accounts", workspaceId, accounts });

export const adsDisconnect = (platform: Platform, workspaceId: string) =>
  callFunction<{ ok: boolean }>(FUNCTIONS[platform], { action: "disconnect", workspaceId });

interface StepResult {
  rows?: number;
  remaining?: number;
  runId?: string | null;
}

/**
 * Синхронизация кабинетов одной платформы по шагам: курсы валют, структура, статистика окнами, превью.
 * Шаги короткие, поэтому прогресс честный: onProgress получает долю от 0 до 1.
 */
export async function runAdSync(
  platform: Platform,
  workspaceId: string,
  accounts: SyncAccount[],
  today: string,
  days: number,
  onProgress?: (progress: number, account: string) => void,
): Promise<FnResult<{ rows: number }>> {
  const step = (name: string, extra: Record<string, unknown> = {}) =>
    callFunction<StepResult>(FUNCTIONS[platform], { action: "sync_step", workspaceId, step: name, ...extra });

  const since = addDays(today, -(days - 1));
  const windows: { since: string; until: string }[] = [];
  for (let from = since; from <= today; from = addDays(from, INSIGHTS_WINDOW_DAYS)) {
    const until = addDays(from, INSIGHTS_WINDOW_DAYS - 1);
    windows.push({ since: from, until: until > today ? today : until });
  }

  // Шаги на кабинет: структура + окна статистики + превью; плюс один общий шаг курсов
  const stepsPerAccount = windows.length + 2;
  const total = 1 + accounts.length * stepsPerAccount;
  let done = 0;
  const tick = (account = "") => onProgress?.(++done / total, account);

  const rates = await step("rates", { since, until: today });
  if (!rates.ok) return rates;
  tick();

  let rows = 0;
  for (const account of accounts) {
    const begin = await step("begin", { accountId: account.id });
    const runId = begin.ok ? begin.data.runId : null;
    let accountRows = 0;
    const finish = (error?: string) => step("finish", { runId, rows: accountRows, error });
    const run = async (name: string, extra: Record<string, unknown> = {}) => {
      const result = await step(name, { accountId: account.id, ...extra });
      if (result.ok) accountRows += result.data.rows ?? 0;
      return result;
    };

    const structure = await run("structure");
    if (!structure.ok) {
      await finish(structure.detail ?? structure.error);
      return structure;
    }
    tick(account.name);

    for (const window of windows) {
      const insights = await run("insights", window);
      if (!insights.ok) {
        await finish(insights.detail ?? insights.error);
        return insights;
      }
      tick(account.name);
    }

    // Превью не критичны: если платформа их не отдала, статистика всё равно загружена
    for (let i = 0; i < MAX_THUMBNAIL_STEPS; i++) {
      const thumbnails = await run("thumbnails");
      if (!thumbnails.ok || !thumbnails.data.remaining) break;
    }
    tick(account.name);

    await finish();
    rows += accountRows;
  }
  return { ok: true, data: { rows } };
}
