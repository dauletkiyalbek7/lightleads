// Общие шаги синхронизации рекламы: запись в базу, превью в Storage и курсы НБРК.
// Что и как читать у конкретной платформы, описано в её функции (meta-oauth, tiktok-oauth).
import { admin, HttpError, type Platform } from "./core.ts";

export const SUPPORTED_CURRENCIES = ["USD", "KZT"];
export const THUMBNAILS_PER_STEP = 20;
/** Пустая строка в thumbnail_path: превью у креатива нет, повторно не ищем. */
export const NO_THUMBNAIL = "";
const UPSERT_CHUNK = 500;
/** PostgREST отдаёт не больше 1000 строк за запрос. */
const PAGE_SIZE = 1000;
const MAX_PAGES = 100;
const IN_FILTER_CHUNK = 200;
const RATES_CONCURRENCY = 8;
const STORAGE_BUCKET = "creatives";

export interface Account {
  id: string;
  workspace_id: string;
  external_id: string;
  currency: string;
}

export type Row = Record<string, unknown>;

export const num = (value?: string | number | null) => Number(value ?? 0) || 0;
export const now = () => new Date().toISOString();
export const chunk = <T>(list: T[], size: number): T[][] => Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, (i + 1) * size));

/** upsert с возвратом соответствия «внешний ID → наш ID». */
export async function upsertMap(table: string, rows: Row[], onConflict: string): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (const part of chunk(rows, UPSERT_CHUNK)) {
    const { data, error } = await admin.from(table).upsert(part, { onConflict }).select("id, external_id");
    if (error) throw new HttpError(500, "db_error", `${table}: ${error.message}`);
    for (const row of data ?? []) map.set(row.external_id, row.id);
  }
  return map;
}

export async function existingMap(table: string, column: string, value: string): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (let page = 0; page < MAX_PAGES; page++) {
    const { data, error } = await admin
      .from(table)
      .select("id, external_id")
      .eq(column, value)
      .order("id")
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
    if (error) throw new HttpError(500, "db_error", `${table}: ${error.message}`);
    for (const row of data ?? []) map.set(row.external_id, row.id);
    if ((data?.length ?? 0) < PAGE_SIZE) break;
  }
  return map;
}

// ---------- Статистика ----------

/** Строка отчёта платформы: объявление с названиями его группы и кампании. */
export interface ReportedAd {
  adId: string;
  adName?: string;
  adsetId: string;
  adsetName?: string;
  campaignId: string;
  campaignName?: string;
  date: string;
}

/**
 * Соответствие «внешний ID объявления → наш ID» для строк отчёта. Архивные и удалённые
 * объявления в списках структуры не приходят, но расход по ним есть: для них создаём
 * записи по названиям из отчёта. creativeByAd — креативы таких объявлений, если платформа их отдала.
 */
export async function resolveReportedAds(
  account: Account,
  platform: Platform,
  reported: ReportedAd[],
  creativeByAd: Map<string, string> = new Map(),
): Promise<Map<string, string>> {
  const base = { workspace_id: account.workspace_id, updated_at: now() };
  const campaignIds = await existingMap("campaigns", "account_id", account.id);
  const adIds = await existingMap("ads", "account_id", account.id);

  const missingCampaigns = new Map<string, Row>();
  for (const row of reported) {
    if (campaignIds.has(row.campaignId) || missingCampaigns.has(row.campaignId)) continue;
    missingCampaigns.set(row.campaignId, { ...base, account_id: account.id, platform, external_id: row.campaignId, name: row.campaignName ?? row.campaignId, status: "paused" });
  }
  for (const [externalId, id] of await upsertMap("campaigns", [...missingCampaigns.values()], "account_id,external_id")) campaignIds.set(externalId, id);

  const missingAds = reported.filter((row) => !adIds.has(row.adId));
  if (!missingAds.length) return adIds;

  const adsetRows = new Map<string, Row>();
  for (const row of missingAds) {
    const campaignId = campaignIds.get(row.campaignId);
    if (campaignId) adsetRows.set(row.adsetId, { ...base, campaign_id: campaignId, external_id: row.adsetId, name: row.adsetName ?? row.adsetId, status: "paused" });
  }
  // Статус существующих групп не трогаем: ignoreDuplicates оставляет строку как есть
  for (const part of chunk([...adsetRows.values()], UPSERT_CHUNK)) {
    await admin.from("adsets").upsert(part, { onConflict: "campaign_id,external_id", ignoreDuplicates: true });
  }
  const adsetIds = new Map<string, string>();
  for (const part of chunk([...adsetRows.keys()], IN_FILTER_CHUNK)) {
    const { data: adsets } = await admin.from("adsets").select("id, external_id").eq("workspace_id", account.workspace_id).in("external_id", part);
    for (const row of adsets ?? []) adsetIds.set(row.external_id, row.id);
  }

  const adRows = new Map<string, Row>();
  for (const row of missingAds) {
    const campaignId = campaignIds.get(row.campaignId);
    const adsetId = adsetIds.get(row.adsetId);
    if (!campaignId || !adsetId) continue;
    adRows.set(row.adId, {
      ...base,
      account_id: account.id,
      campaign_id: campaignId,
      adset_id: adsetId,
      creative_id: creativeByAd.get(row.adId) ?? null,
      platform,
      external_id: row.adId,
      name: row.adName ?? row.adId,
      status: "paused",
      start_date: row.date,
    });
  }
  for (const [externalId, id] of await upsertMap("ads", [...adRows.values()], "account_id,external_id")) adIds.set(externalId, id);
  return adIds;
}

/** Записывает строки «объявление × день» и отмечает время синхронизации кабинета. */
export async function saveInsights(account: Account, rows: Row[]): Promise<number> {
  for (const part of chunk(rows, UPSERT_CHUNK)) {
    const { error } = await admin.from("insights_daily").upsert(part, { onConflict: "ad_id,date" });
    if (error) throw new HttpError(500, "db_error", `insights_daily: ${error.message}`);
  }
  await admin.from("ad_accounts").update({ last_synced_at: now() }).eq("id", account.id);
  return rows.length;
}

// ---------- Превью ----------

export interface PendingCreative {
  id: string;
  external_id: string;
  type: string;
}

/** Очередная порция креативов без превью и сколько их останется после неё. */
export async function pendingThumbnails(account: Account): Promise<{ pending: PendingCreative[]; remaining: number }> {
  const { data, count } = await admin
    .from("creatives")
    .select("id, external_id, type", { count: "exact" })
    .eq("account_id", account.id)
    .is("thumbnail_path", null)
    .limit(THUMBNAILS_PER_STEP);
  const pending = data ?? [];
  return { pending, remaining: Math.max((count ?? pending.length) - pending.length, 0) };
}

/**
 * Копирует превью в Storage: ссылки рекламных платформ живут недолго.
 * Если картинки нет или она не скачалась, креатив помечается «без превью».
 */
export async function storeThumbnail(account: Account, creativeId: string, url?: string | null, extra: Row = {}) {
  let path = NO_THUMBNAIL;
  if (url) {
    const image = await fetch(url).catch(() => null);
    if (image?.ok) {
      const target = `${account.workspace_id}/${creativeId}.jpg`;
      const { error } = await admin.storage.from(STORAGE_BUCKET).upload(target, await image.arrayBuffer(), {
        contentType: image.headers.get("content-type") ?? "image/jpeg",
        upsert: true,
      });
      if (!error) path = target;
    }
  }
  await admin.from("creatives").update({ ...extra, thumbnail_path: path }).eq("id", creativeId);
}

// ---------- Курсы валют ----------

const NBRK_URL = "https://nationalbank.kz/rss/get_rates.cfm";
const USD_RATE_RE = /<title>USD<\/title>[\s\S]*?<description>([\d.]+)<\/description>/;

/** Курс НБРК (тенге за 1 USD) на недостающие даты периода. */
export async function syncRates(since: string, until: string): Promise<number> {
  const dates: string[] = [];
  for (let d = new Date(`${since}T00:00:00Z`); d <= new Date(`${until}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) dates.push(d.toISOString().slice(0, 10));
  const { data: known } = await admin.from("exchange_rates").select("date").gte("date", since).lte("date", until);
  const have = new Set((known ?? []).map((row) => row.date));
  const missing = dates.filter((date) => !have.has(date));

  const rows: Row[] = [];
  for (const part of chunk(missing, RATES_CONCURRENCY)) {
    await Promise.all(
      part.map(async (date) => {
        const [year, month, day] = date.split("-");
        const response = await fetch(`${NBRK_URL}?fdate=${day}.${month}.${year}`).catch(() => null);
        const rate = Number((await response?.text())?.match(USD_RATE_RE)?.[1]);
        if (rate > 0) rows.push({ date, usd_kzt: rate });
      }),
    );
  }
  if (rows.length) {
    const { error } = await admin.from("exchange_rates").upsert(rows, { onConflict: "date" });
    if (error) throw new HttpError(500, "db_error", `exchange_rates: ${error.message}`);
  }
  return rows.length;
}
