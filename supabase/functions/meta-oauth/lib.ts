// Запросы к Graph API и настройки приложения Meta.
import { HttpError, sleep, TOKEN_EXPIRED } from "../_shared/core.ts";

export const META_APP_ID = Deno.env.get("META_APP_ID") ?? "";
export const META_APP_SECRET = Deno.env.get("META_APP_SECRET") ?? "";
/** Необязательно: ID конфигурации Facebook Login for Business. Без него права передаются через scope. */
export const META_LOGIN_CONFIG_ID = Deno.env.get("META_LOGIN_CONFIG_ID") ?? "";
/**
 * Версия Graph API. Рекламный API отклоняет запросы без версии и со старой версией
 * (ошибка #2635), поэтому она указана явно. Когда Meta снимет её с поддержки,
 * задайте новую в секрете META_GRAPH_VERSION или поменяйте значение здесь.
 */
const GRAPH_VERSION = Deno.env.get("META_GRAPH_VERSION") || "v26.0";

export const GRAPH_URL = `https://graph.facebook.com/${GRAPH_VERSION}`;
export const DIALOG_URL = `https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth`;
/** Только чтение рекламы. Права на лид-формы и страницы добавятся в Фазе 4. */
export const META_SCOPES = ["ads_read"];

const MAX_RETRIES = 3;
const RETRY_BASE_MS = 1500;
/** Коды Graph API «слишком много запросов»: ждём и повторяем. */
const RATE_LIMIT_CODES = new Set([4, 17, 32, 613, 80000, 80004]);
/** Код «токен недействителен»: кабинет нужно переподключить. */
const TOKEN_ERROR_CODE = 190;
const MAX_PAGES = 40;
/** Ответ Meta «слишком много данных»: повтор того же запроса не поможет, нужна страница поменьше. */
const TOO_MUCH_DATA_TEXT = "reduce the amount of data";
const TOO_MUCH_DATA = "too_much_data";
/** Меньше этого страницу не делим: дальше ошибка уже не в размере. */
const MIN_PAGE_LIMIT = 10;

interface GraphError {
  message?: string;
  code?: number;
}

const isTooMuchData = (message?: string) => (message ?? "").toLowerCase().includes(TOO_MUCH_DATA_TEXT);

/** GET к Graph API с повторами при лимитах и временных сбоях. */
export async function graphGet<T>(pathOrUrl: string, params: Record<string, string> = {}, token?: string): Promise<T> {
  const url = new URL(pathOrUrl.startsWith("http") ? pathOrUrl : `${GRAPH_URL}${pathOrUrl}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  if (token) url.searchParams.set("access_token", token);

  for (let attempt = 0; ; attempt++) {
    const response = await fetch(url);
    const payload = (await response.json().catch(() => ({}))) as { error?: GraphError };
    if (response.ok && !payload.error) return payload as T;

    const error = payload.error ?? {};
    if (error.code === TOKEN_ERROR_CODE) throw new HttpError(401, TOKEN_EXPIRED, error.message);
    if (isTooMuchData(error.message)) throw new HttpError(502, TOO_MUCH_DATA, error.message);
    const retryable = response.status >= 500 || RATE_LIMIT_CODES.has(error.code ?? -1);
    if (!retryable || attempt >= MAX_RETRIES) throw new HttpError(502, "platform_error", error.message ?? `HTTP ${response.status}`);
    await sleep(RETRY_BASE_MS * 2 ** attempt);
  }
}

interface GraphPage<T> {
  data?: T[];
  paging?: { next?: string; cursors?: { after?: string } };
}

/**
 * Одна страница списка и метка следующей страницы (null — страница последняя).
 * Если Meta не может отдать страницу целиком, просит её вдвое меньшей: метка следующей страницы от размера не зависит.
 */
export async function graphPage<T>(path: string, params: Record<string, string>, token: string, after?: string | null): Promise<{ data: T[]; after: string | null }> {
  let limit = Number(params.limit) || 0;
  for (;;) {
    const query = { ...params, ...(limit ? { limit: String(limit) } : {}), ...(after ? { after } : {}) };
    try {
      const page = await graphGet<GraphPage<T>>(path, query, token);
      return { data: page.data ?? [], after: page.paging?.next ? (page.paging.cursors?.after ?? null) : null };
    } catch (error) {
      if (!(error instanceof HttpError) || error.code !== TOO_MUCH_DATA || limit <= MIN_PAGE_LIMIT) throw error;
      limit = Math.max(Math.floor(limit / 2), MIN_PAGE_LIMIT);
    }
  }
}

/** Собирает все страницы списка (paging.next). */
export async function graphList<T>(path: string, params: Record<string, string>, token: string): Promise<T[]> {
  const rows: T[] = [];
  let page = await graphGet<GraphPage<T>>(path, params, token);
  for (let i = 0; i < MAX_PAGES; i++) {
    rows.push(...(page.data ?? []));
    if (!page.paging?.next) break;
    page = await graphGet(page.paging.next);
  }
  return rows;
}
