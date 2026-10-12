// Синхронизация Meta: структура кабинета, статистика по дням, превью креативов и курсы НБРК.
// Каждый шаг — отдельный короткий вызов, чтобы уложиться в лимиты Edge Functions
// и показывать пользователю прогресс первой загрузки.
import { admin, graphGet, graphList, HttpError } from "./lib.ts";

export const SUPPORTED_CURRENCIES = ["USD", "KZT"];
const UPSERT_CHUNK = 500;
const THUMBNAILS_PER_STEP = 20;
const THUMBNAIL_SIZE = { thumbnail_width: "600", thumbnail_height: "750" };
/** Meta отдаёт бюджеты в минимальных единицах валюты (центы, тиыны). */
const BUDGET_DIVISOR = 100;
const RATES_CONCURRENCY = 8;
const STORAGE_BUCKET = "creatives";
/** Пустая строка в thumbnail_path: превью у креатива нет, повторно не ищем. */
const NO_THUMBNAIL = "";

export interface Account {
  id: string;
  workspace_id: string;
  external_id: string;
  currency: string;
}

interface Named {
  id: string;
  name?: string;
}
interface GraphCampaign extends Named {
  objective?: string;
  effective_status?: string;
  daily_budget?: string;
}
interface GraphAdSet extends Named {
  campaign_id: string;
  effective_status?: string;
}
interface GraphAd extends Named {
  adset_id: string;
  campaign_id: string;
  effective_status?: string;
  created_time?: string;
  creative?: GraphCreative;
}
interface GraphCreative extends Named {
  title?: string;
  body?: string;
  thumbnail_url?: string;
  image_url?: string;
  video_id?: string;
  object_type?: string;
  call_to_action_type?: string;
}
interface ActionStat {
  action_type: string;
  value: string;
}
interface GraphInsight {
  ad_id: string;
  ad_name?: string;
  adset_id: string;
  adset_name?: string;
  campaign_id: string;
  campaign_name?: string;
  date_start: string;
  spend?: string;
  impressions?: string;
  reach?: string;
  clicks?: string;
  inline_link_clicks?: string;
  actions?: ActionStat[];
  action_values?: ActionStat[];
  video_play_actions?: ActionStat[];
  video_thruplay_watched_actions?: ActionStat[];
  video_avg_time_watched_actions?: ActionStat[];
}

const status = (effective?: string) => (effective === "ACTIVE" ? "active" : "paused");
const num = (value?: string) => Number(value ?? 0) || 0;
const chunk = <T>(list: T[], size: number): T[][] => Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, (i + 1) * size));

/** Цель кампании Meta → цель в LightLeads. */
function objective(value?: string): string | null {
  const v = (value ?? "").toUpperCase();
  if (!v) return null;
  if (v.includes("LEAD")) return "leads";
  if (v.includes("MESSAG")) return "messages";
  if (v.includes("SALES") || v.includes("CONVERSION") || v.includes("CATALOG")) return "sales";
  if (v.includes("TRAFFIC") || v.includes("LINK_CLICKS")) return "traffic";
  return "awareness";
}

/** Первое найденное действие из списка: типы пересекаются, складывать их нельзя. */
function action(list: ActionStat[] | undefined, types: string[]): number {
  for (const type of types) {
    const found = list?.find((a) => a.action_type === type);
    if (found) return num(found.value);
  }
  return 0;
}

type Row = Record<string, unknown>;

/** upsert с возвратом соответствия «внешний ID → наш ID». */
async function upsertMap(table: string, rows: Row[], onConflict: string): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (const part of chunk(rows, UPSERT_CHUNK)) {
    const { data, error } = await admin.from(table).upsert(part, { onConflict }).select("id, external_id");
    if (error) throw new HttpError(500, "db_error", `${table}: ${error.message}`);
    for (const row of data ?? []) map.set(row.external_id, row.id);
  }
  return map;
}

async function existingMap(table: string, column: string, value: string): Promise<Map<string, string>> {
  const { data, error } = await admin.from(table).select("id, external_id").eq(column, value);
  if (error) throw new HttpError(500, "db_error", `${table}: ${error.message}`);
  return new Map((data ?? []).map((row) => [row.external_id, row.id]));
}

const now = () => new Date().toISOString();

/** Кампании, группы, объявления и креативы кабинета. */
export async function syncStructure(account: Account, token: string): Promise<number> {
  const base = { workspace_id: account.workspace_id, updated_at: now() };
  const path = `/${account.external_id}`;

  const campaigns = await graphList<GraphCampaign>(`${path}/campaigns`, { fields: "id,name,objective,effective_status,daily_budget", limit: "500" }, token);
  const campaignIds = await upsertMap(
    "campaigns",
    campaigns.map((c) => ({
      ...base,
      account_id: account.id,
      platform: "meta",
      external_id: c.id,
      name: c.name ?? c.id,
      objective: objective(c.objective),
      status: status(c.effective_status),
      daily_budget: c.daily_budget ? num(c.daily_budget) / BUDGET_DIVISOR : null,
    })),
    "account_id,external_id",
  );

  const adsets = await graphList<GraphAdSet>(`${path}/adsets`, { fields: "id,name,campaign_id,effective_status", limit: "500" }, token);
  const adsetIds = new Map<string, string>();
  for (const [campaignExternalId, campaignId] of campaignIds) {
    const rows = adsets
      .filter((a) => a.campaign_id === campaignExternalId)
      .map((a) => ({ ...base, campaign_id: campaignId, external_id: a.id, name: a.name ?? a.id, status: status(a.effective_status) }));
    if (!rows.length) continue;
    for (const [externalId, id] of await upsertMap("adsets", rows, "campaign_id,external_id")) adsetIds.set(externalId, id);
  }

  // Креатив приходит вложенным в объявление: запрос нескольких объектов по ?ids= в v26.0 отключён
  const ads = await graphList<GraphAd>(
    `${path}/ads`,
    { fields: "id,name,adset_id,campaign_id,effective_status,created_time,creative{id,name,title,body,video_id,object_type,call_to_action_type}", limit: "200" },
    token,
  );
  const creatives = [...new Map(ads.flatMap((ad) => (ad.creative?.id ? [[ad.creative.id, ad.creative] as const] : []))).values()];
  const adNameByCreative = new Map(ads.flatMap((ad) => (ad.creative?.id ? [[ad.creative.id, ad.name ?? ""] as const] : [])));
  const creativeIds = await upsertMap(
    "creatives",
    creatives.map((c) => ({
      ...base,
      account_id: account.id,
      external_id: c.id,
      name: adNameByCreative.get(c.id) || c.name || c.id,
      type: c.video_id || c.object_type === "VIDEO" ? "video" : "image",
      title: c.title ?? "",
      body: c.body ?? "",
      cta: c.call_to_action_type ?? "",
    })),
    "account_id,external_id",
  );

  const adRows = ads.flatMap((ad) => {
    const campaignId = campaignIds.get(ad.campaign_id);
    const adsetId = adsetIds.get(ad.adset_id);
    if (!campaignId || !adsetId) return [];
    return [
      {
        ...base,
        account_id: account.id,
        campaign_id: campaignId,
        adset_id: adsetId,
        creative_id: ad.creative?.id ? (creativeIds.get(ad.creative.id) ?? null) : null,
        platform: "meta",
        external_id: ad.id,
        name: ad.name ?? ad.id,
        status: status(ad.effective_status),
        start_date: ad.created_time?.slice(0, 10) ?? null,
      },
    ];
  });
  await upsertMap("ads", adRows, "account_id,external_id");
  await admin.from("ad_accounts").update({ last_synced_at: now(), status: "active" }).eq("id", account.id);
  return campaigns.length + adsets.length + adRows.length + creatives.length;
}

/**
 * Статистика «объявление × день» за период. Архивные объявления в списках структуры
 * не приходят, но расход по ним есть: для них создаём записи по названиям из отчёта.
 */
export async function syncInsights(account: Account, token: string, since: string, until: string): Promise<number> {
  const insights = await graphList<GraphInsight>(
    `/${account.external_id}/insights`,
    {
      level: "ad",
      time_increment: "1",
      time_range: JSON.stringify({ since, until }),
      fields:
        "ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,spend,impressions,reach,clicks,inline_link_clicks,actions,action_values,video_play_actions,video_thruplay_watched_actions,video_avg_time_watched_actions",
      limit: "500",
    },
    token,
  );
  if (!insights.length) return 0;

  const base = { workspace_id: account.workspace_id, updated_at: now() };
  const campaignIds = await existingMap("campaigns", "account_id", account.id);
  const adIds = await existingMap("ads", "account_id", account.id);

  const missingCampaigns = new Map<string, Row>();
  for (const row of insights) {
    if (campaignIds.has(row.campaign_id) || missingCampaigns.has(row.campaign_id)) continue;
    missingCampaigns.set(row.campaign_id, { ...base, account_id: account.id, platform: "meta", external_id: row.campaign_id, name: row.campaign_name ?? row.campaign_id, status: "paused" });
  }
  for (const [externalId, id] of await upsertMap("campaigns", [...missingCampaigns.values()], "account_id,external_id")) campaignIds.set(externalId, id);

  const missingAds = insights.filter((row) => !adIds.has(row.ad_id));
  if (missingAds.length) {
    const adsetIds = new Map<string, string>();
    const adsetRows = new Map<string, Row>();
    for (const row of missingAds) {
      const campaignId = campaignIds.get(row.campaign_id);
      if (campaignId) adsetRows.set(row.adset_id, { ...base, campaign_id: campaignId, external_id: row.adset_id, name: row.adset_name ?? row.adset_id });
    }
    // Статус существующих групп не трогаем: ignoreDuplicates оставляет строку как есть
    for (const part of chunk([...adsetRows.values()], UPSERT_CHUNK)) {
      await admin.from("adsets").upsert(part.map((r) => ({ ...r, status: "paused" })), { onConflict: "campaign_id,external_id", ignoreDuplicates: true });
    }
    const { data: adsets } = await admin
      .from("adsets")
      .select("id, external_id")
      .eq("workspace_id", account.workspace_id)
      .in("external_id", [...adsetRows.keys()]);
    for (const row of adsets ?? []) adsetIds.set(row.external_id, row.id);

    const adRows = new Map<string, Row>();
    for (const row of missingAds) {
      const campaignId = campaignIds.get(row.campaign_id);
      const adsetId = adsetIds.get(row.adset_id);
      if (!campaignId || !adsetId) continue;
      adRows.set(row.ad_id, { ...base, account_id: account.id, campaign_id: campaignId, adset_id: adsetId, platform: "meta", external_id: row.ad_id, name: row.ad_name ?? row.ad_id, status: "paused", start_date: row.date_start });
    }
    for (const [externalId, id] of await upsertMap("ads", [...adRows.values()], "account_id,external_id")) adIds.set(externalId, id);
  }

  const rows = insights.flatMap((row) => {
    const adId = adIds.get(row.ad_id);
    if (!adId) return [];
    const plays = action(row.video_play_actions, ["video_view"]);
    return [
      {
        ad_id: adId,
        date: row.date_start,
        workspace_id: account.workspace_id,
        currency: account.currency,
        spend: num(row.spend),
        impressions: num(row.impressions),
        reach: num(row.reach),
        // Клики по ссылке: по ним Ads Manager считает CPC и CTR по умолчанию
        clicks: row.inline_link_clicks ? num(row.inline_link_clicks) : num(row.clicks),
        pixel_purchases: action(row.actions, ["omni_purchase", "purchase", "offsite_conversion.fb_pixel_purchase"]),
        pixel_value: action(row.action_values, ["omni_purchase", "purchase", "offsite_conversion.fb_pixel_purchase"]),
        platform_leads: action(row.actions, ["lead", "onsite_conversion.lead_grouped", "offsite_conversion.fb_pixel_lead"]),
        messaging_started: action(row.actions, ["onsite_conversion.messaging_conversation_started_7d"]),
        video_plays: plays,
        video_3s: action(row.actions, ["video_view"]),
        video_hold: action(row.video_thruplay_watched_actions, ["video_view"]),
        video_watch_sec: action(row.video_avg_time_watched_actions, ["video_view"]) * plays,
      },
    ];
  });
  for (const part of chunk(rows, UPSERT_CHUNK)) {
    const { error } = await admin.from("insights_daily").upsert(part, { onConflict: "ad_id,date" });
    if (error) throw new HttpError(500, "db_error", `insights_daily: ${error.message}`);
  }
  await admin.from("ad_accounts").update({ last_synced_at: now() }).eq("id", account.id);
  return rows.length;
}

/** Скачивает превью в Storage: ссылки Meta живут недолго. Возвращает, сколько креативов осталось. */
export async function syncThumbnails(account: Account, token: string): Promise<{ done: number; remaining: number }> {
  const { data: pending, count } = await admin
    .from("creatives")
    .select("id, external_id", { count: "exact" })
    .eq("account_id", account.id)
    .is("thumbnail_path", null)
    .limit(THUMBNAILS_PER_STEP);
  if (!pending?.length) return { done: 0, remaining: 0 };

  await Promise.all(
    pending.map(async (creative) => {
      // Свежую ссылку на превью спрашиваем у каждого креатива отдельно; сбой одного не мешает остальным
      const source = await graphGet<GraphCreative>(`/${creative.external_id}`, { fields: "thumbnail_url,image_url", ...THUMBNAIL_SIZE }, token).catch(() => null);
      const url = source?.thumbnail_url ?? source?.image_url;
      let path = NO_THUMBNAIL;
      if (url) {
        const image = await fetch(url).catch(() => null);
        if (image?.ok) {
          const target = `${account.workspace_id}/${creative.id}.jpg`;
          const { error } = await admin.storage.from(STORAGE_BUCKET).upload(target, await image.arrayBuffer(), {
            contentType: image.headers.get("content-type") ?? "image/jpeg",
            upsert: true,
          });
          if (!error) path = target;
        }
      }
      await admin.from("creatives").update({ thumbnail_path: path }).eq("id", creative.id);
    }),
  );
  return { done: pending.length, remaining: Math.max((count ?? pending.length) - pending.length, 0) };
}

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
