import { addDays } from "./dates";
import { callFunction, type FnResult } from "./supabase/functions";

/** Запросы к Edge Function `meta-oauth` (supabase/functions/meta-oauth): кабинеты Meta и их синхронизация. */
const FUNCTION = "meta-oauth";

/** Первая загрузка: глубина истории и размер одного запроса статистики, дней. */
export const INITIAL_SYNC_DAYS = 90;
const INSIGHTS_WINDOW_DAYS = 10;
/** Обычное обновление перечитывает последние дни: Meta пересчитывает статистику задним числом. */
export const REFRESH_SYNC_DAYS = 3;
/** Страховка от бесконечного цикла, если превью не скачиваются. */
const MAX_THUMBNAIL_STEPS = 40;

export interface MetaAccountOption {
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

export const metaStart = (workspaceId: string) =>
  callFunction<{ url: string }>(FUNCTION, { action: "start", workspaceId, origin: window.location.origin });

export const metaAccounts = (workspaceId: string) => callFunction<{ accounts: MetaAccountOption[] }>(FUNCTION, { action: "accounts", workspaceId });

export const metaSelectAccounts = (workspaceId: string, accounts: string[]) =>
  callFunction<{ accounts: SyncAccount[] }>(FUNCTION, { action: "select_accounts", workspaceId, accounts });

export const metaDisconnect = (workspaceId: string) => callFunction<{ ok: boolean }>(FUNCTION, { action: "disconnect", workspaceId });

interface StepResult {
  rows?: number;
  remaining?: number;
  runId?: string | null;
}

const step = (workspaceId: string, name: string, extra: Record<string, unknown> = {}) =>
  callFunction<StepResult>(FUNCTION, { action: "sync_step", workspaceId, step: name, ...extra });

/**
 * Синхронизация кабинетов по шагам: курсы валют, структура, статистика окнами, превью.
 * Шаги короткие, поэтому прогресс честный: onProgress получает долю от 0 до 1.
 */
export async function runMetaSync(
  workspaceId: string,
  accounts: SyncAccount[],
  today: string,
  days: number,
  onProgress?: (progress: number, account: string) => void,
): Promise<FnResult<{ rows: number }>> {
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

  const rates = await step(workspaceId, "rates", { since, until: today });
  if (!rates.ok) return rates;
  tick();

  let rows = 0;
  for (const account of accounts) {
    const begin = await step(workspaceId, "begin", { accountId: account.id });
    const runId = begin.ok ? begin.data.runId : null;
    let accountRows = 0;
    const finish = (error?: string) => step(workspaceId, "finish", { runId, rows: accountRows, error });
    const run = async (name: string, extra: Record<string, unknown> = {}) => {
      const result = await step(workspaceId, name, { accountId: account.id, ...extra });
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

    // Превью не критичны: если Meta их не отдала, статистика всё равно загружена
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
