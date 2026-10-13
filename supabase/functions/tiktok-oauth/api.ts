// Запросы к TikTok for Business Marketing API v1.3 и настройки приложения TikTok.
import { HttpError, sleep, TOKEN_EXPIRED } from "../_shared/core.ts";

export const TIKTOK_APP_ID = Deno.env.get("TIKTOK_APP_ID") ?? "";
export const TIKTOK_APP_SECRET = Deno.env.get("TIKTOK_APP_SECRET") ?? "";

const API_URL = "https://business-api.tiktok.com/open_api/v1.3";
/** Окно, в котором рекламодатель выдаёт приложению доступ к кабинетам. */
export const AUTH_URL = "https://business-api.tiktok.com/portal/auth";

const OK_CODE = 0;
const MAX_RETRIES = 3;
const RETRY_BASE_MS = 1500;
const HTTP_TOO_MANY_REQUESTS = 429;
/** Коды «слишком много запросов»: ждём и повторяем. */
const RATE_LIMIT_CODES = new Set([40100, 40016]);
/** Коды «токен истёк, пуст или отозван»: кабинет нужно переподключить. */
const TOKEN_ERROR_CODES = new Set([40102, 40104, 40105]);
/** С этого кода начинаются сбои на стороне TikTok: их стоит повторить. */
const SERVER_ERROR_FROM = 50000;
const PAGE_SIZE = 1000;
const MAX_PAGES = 40;

/** Параметры запроса: списки и объекты TikTok принимает строкой JSON. */
export type Params = Record<string, string | number | boolean | unknown[] | Record<string, unknown>>;

interface Envelope<T> {
  code?: number;
  message?: string;
  data?: T;
}

async function request<T>(method: "GET" | "POST", path: string, params: Params, token?: string): Promise<T> {
  const url = new URL(`${API_URL}${path}`);
  if (method === "GET") {
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, typeof value === "string" ? value : JSON.stringify(value));
  }
  const init: RequestInit = {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { "Access-Token": token } : {}) },
    body: method === "POST" ? JSON.stringify(params) : undefined,
  };

  for (let attempt = 0; ; attempt++) {
    const response = await fetch(url, init);
    const payload = (await response.json().catch(() => ({}))) as Envelope<T>;
    if (response.ok && payload.code === OK_CODE) return (payload.data ?? {}) as T;

    const code = payload.code ?? -1;
    if (TOKEN_ERROR_CODES.has(code)) throw new HttpError(401, TOKEN_EXPIRED, payload.message);
    const retryable = response.status >= 500 || response.status === HTTP_TOO_MANY_REQUESTS || RATE_LIMIT_CODES.has(code) || code >= SERVER_ERROR_FROM;
    if (!retryable || attempt >= MAX_RETRIES) throw new HttpError(502, "platform_error", payload.message ?? `HTTP ${response.status}`);
    await sleep(RETRY_BASE_MS * 2 ** attempt);
  }
}

/** GET с повторами при лимитах и временных сбоях. Возвращает поле data ответа. */
export const tiktokGet = <T>(path: string, params: Params, token?: string) => request<T>("GET", path, params, token);

export const tiktokPost = <T>(path: string, body: Params) => request<T>("POST", path, body);

/** Собирает все страницы списка (page_info.total_page). */
export async function tiktokList<T>(path: string, params: Params, token: string): Promise<T[]> {
  const rows: T[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const data = await tiktokGet<{ list?: T[]; page_info?: { total_page?: number } }>(path, { ...params, page, page_size: PAGE_SIZE }, token);
    rows.push(...(data.list ?? []));
    if (page >= (data.page_info?.total_page ?? 0)) break;
  }
  return rows;
}
