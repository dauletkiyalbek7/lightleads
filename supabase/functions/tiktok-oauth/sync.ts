// Синхронизация TikTok Ads: структура кабинета, статистика по дням и обложки креативов.
// Каждый шаг — отдельный короткий вызов, чтобы уложиться в лимиты Edge Functions
// и показывать пользователю прогресс первой загрузки.
import { admin } from "../_shared/core.ts";
import {
  type Account,
  chunk,
  existingMap,
  now,
  num,
  pendingThumbnails,
  resolveReportedAds,
  type Row,
  saveInsights,
  storeThumbnail,
  upsertMap,
} from "../_shared/sync.ts";
import { tiktokGet, tiktokList } from "./api.ts";

const CAMPAIGN_FIELDS = ["campaign_id", "campaign_name", "objective_type", "operation_status", "secondary_status", "budget", "budget_mode"];
const ADGROUP_FIELDS = ["adgroup_id", "adgroup_name", "campaign_id", "operation_status", "secondary_status"];
const AD_FIELDS = ["ad_id", "ad_name", "adgroup_id", "campaign_id", "operation_status", "secondary_status", "video_id", "image_ids", "ad_text", "call_to_action", "create_time"];
/** Названия и ID родителей в отчёте запрашиваются как метрики: вторым измерением их передать нельзя. */
const REPORT_METRICS = [
  "campaign_id",
  "campaign_name",
  "adgroup_id",
  "adgroup_name",
  "ad_name",
  "spend",
  "impressions",
  "reach",
  "clicks",
  "conversion",
  "complete_payment",
  "total_complete_payment_rate",
  "video_play_actions",
  "video_watched_2s",
  "video_watched_6s",
  "average_video_play",
];
/** Без этого фильтра отчёт молча пропускает удалённые объявления, и расход не сходится с кабинетом. */
const REPORT_ALL_ADS = [{ field_name: "ad_status", filter_type: "IN", filter_value: JSON.stringify(["STATUS_ALL"]) }];
/** Итоговые статусы «показ идёт». Остальные — пауза, модерация, отключённая кампания, закончился бюджет. */
const DELIVERING = new Set(["CAMPAIGN_STATUS_ENABLE", "ADGROUP_STATUS_DELIVERY_OK", "AD_STATUS_DELIVERY_OK"]);
/** У объявления нет ни видео, ни картинки в библиотеке: креатив заводим по самому объявлению. */
const NO_ASSET_PREFIX = "ad:";
const AD_IDS_PER_REQUEST = 100;

interface Stateful {
  operation_status?: string;
  secondary_status?: string;
}
interface TikTokCampaign extends Stateful {
  campaign_id: string;
  campaign_name?: string;
  objective_type?: string;
  budget?: number;
  budget_mode?: string;
}
interface TikTokAdGroup extends Stateful {
  adgroup_id: string;
  adgroup_name?: string;
  campaign_id: string;
}
interface TikTokAd extends Stateful {
  ad_id: string;
  ad_name?: string;
  adgroup_id: string;
  campaign_id: string;
  video_id?: string | null;
  image_ids?: string[] | null;
  ad_text?: string | null;
  call_to_action?: string | null;
  create_time?: string;
}
interface TikTokReportRow {
  dimensions: { ad_id: string; stat_time_day: string };
  metrics: Record<string, string | undefined>;
}
interface TikTokVideo {
  video_id: string;
  video_cover_url?: string;
  duration?: number;
}

/** В тестовой среде TikTok итогового статуса нет: тогда смотрим на переключатель. */
const status = (entity: Stateful) =>
  (entity.secondary_status ? DELIVERING.has(entity.secondary_status) : entity.operation_status === "ENABLE") ? "active" : "paused";

/** Цель кампании TikTok → цель в LightLeads. */
function objective(value?: string): string | null {
  const v = (value ?? "").toUpperCase();
  if (!v) return null;
  if (v.includes("LEAD")) return "leads";
  if (v.includes("CONVERSION") || v.includes("SALES") || v.includes("SHOP") || v.includes("CATALOG")) return "sales";
  if (v.includes("TRAFFIC") || v.includes("APP")) return "traffic";
  return "awareness";
}

/** Дневной бюджет кампании. Бюджет на весь срок и «без ограничения» дневным не считаем. */
const dailyBudget = (campaign: TikTokCampaign) => (campaign.budget && /DAY|DAILY/.test(campaign.budget_mode ?? "") ? campaign.budget : null);

// Отдельной сущности «креатив» у TikTok нет: это видео или картинка, на которые ссылается объявление
const creativeKey = (ad: TikTokAd) => ad.video_id || ad.image_ids?.[0] || `${NO_ASSET_PREFIX}${ad.ad_id}`;
const creativeType = (ad: TikTokAd) => (ad.video_id ? "video" : (ad.image_ids?.length ?? 0) > 1 ? "carousel" : "image");

/** Креативы объявлений: «ключ креатива → наш ID». */
async function upsertCreatives(account: Account, ads: TikTokAd[]): Promise<Map<string, string>> {
  const rows = new Map<string, Row>();
  for (const ad of ads) {
    const key = creativeKey(ad);
    if (rows.has(key)) continue;
    rows.set(key, {
      workspace_id: account.workspace_id,
      updated_at: now(),
      account_id: account.id,
      external_id: key,
      name: ad.ad_name || key,
      type: creativeType(ad),
      body: ad.ad_text ?? "",
      cta: ad.call_to_action ?? "",
    });
  }
  return upsertMap("creatives", [...rows.values()], "account_id,external_id");
}

/** Кампании, группы, объявления и креативы кабинета. */
export async function syncStructure(account: Account, token: string): Promise<number> {
  const base = { workspace_id: account.workspace_id, updated_at: now() };
  const advertiser = { advertiser_id: account.external_id };

  const campaigns = await tiktokList<TikTokCampaign>("/campaign/get/", { ...advertiser, fields: CAMPAIGN_FIELDS }, token);
  const campaignIds = await upsertMap(
    "campaigns",
    campaigns.map((c) => ({
      ...base,
      account_id: account.id,
      platform: "tiktok",
      external_id: c.campaign_id,
      name: c.campaign_name ?? c.campaign_id,
      objective: objective(c.objective_type),
      status: status(c),
      daily_budget: dailyBudget(c),
    })),
    "account_id,external_id",
  );

  const adgroups = await tiktokList<TikTokAdGroup>("/adgroup/get/", { ...advertiser, fields: ADGROUP_FIELDS }, token);
  const adsetIds = await upsertMap(
    "adsets",
    adgroups.flatMap((g) => {
      const campaignId = campaignIds.get(g.campaign_id);
      return campaignId ? [{ ...base, campaign_id: campaignId, external_id: g.adgroup_id, name: g.adgroup_name ?? g.adgroup_id, status: status(g) }] : [];
    }),
    "campaign_id,external_id",
  );

  const ads = await tiktokList<TikTokAd>("/ad/get/", { ...advertiser, fields: AD_FIELDS }, token);
  const creativeIds = await upsertCreatives(account, ads);
  const adRows = ads.flatMap((ad) => {
    const campaignId = campaignIds.get(ad.campaign_id);
    const adsetId = adsetIds.get(ad.adgroup_id);
    if (!campaignId || !adsetId) return [];
    return [
      {
        ...base,
        account_id: account.id,
        campaign_id: campaignId,
        adset_id: adsetId,
        creative_id: creativeIds.get(creativeKey(ad)) ?? null,
        platform: "tiktok",
        external_id: ad.ad_id,
        name: ad.ad_name ?? ad.ad_id,
        status: status(ad),
        start_date: ad.create_time?.slice(0, 10) ?? null,
      },
    ];
  });
  await upsertMap("ads", adRows, "account_id,external_id");
  await admin.from("ad_accounts").update({ last_synced_at: now(), status: "active" }).eq("id", account.id);
  return campaigns.length + adgroups.length + adRows.length + creativeIds.size;
}

/**
 * Креативы удалённых объявлений: в общем списке их нет, но по ID TikTok их отдаёт.
 * Не критично: если запрос не прошёл, объявление останется с обложкой-заглушкой.
 */
async function creativesOfAds(account: Account, token: string, adIds: string[]): Promise<Map<string, string>> {
  const byAd = new Map<string, string>();
  try {
    const ads: TikTokAd[] = [];
    for (const part of chunk(adIds, AD_IDS_PER_REQUEST)) {
      const filtering = { ad_ids: part, primary_status: "STATUS_ALL" };
      ads.push(...(await tiktokList<TikTokAd>("/ad/get/", { advertiser_id: account.external_id, fields: AD_FIELDS, filtering }, token)));
    }
    const creativeIds = await upsertCreatives(account, ads);
    for (const ad of ads) {
      const creativeId = creativeIds.get(creativeKey(ad));
      if (creativeId) byAd.set(ad.ad_id, creativeId);
    }
  } catch (error) {
    console.error("tiktok: creatives of deleted ads failed", error);
  }
  return byAd;
}

/** Статистика «объявление × день» за период (не больше 30 дней на запрос). */
export async function syncInsights(account: Account, token: string, since: string, until: string): Promise<number> {
  const report = await tiktokList<TikTokReportRow>(
    "/report/integrated/get/",
    {
      advertiser_id: account.external_id,
      report_type: "BASIC",
      data_level: "AUCTION_AD",
      dimensions: ["ad_id", "stat_time_day"],
      metrics: REPORT_METRICS,
      start_date: since,
      end_date: until,
      filtering: REPORT_ALL_ADS,
    },
    token,
  );
  // TikTok возвращает строку на каждый день каждого объявления, даже если показов не было
  const delivered = report.filter((row) => num(row.metrics.spend) > 0 || num(row.metrics.impressions) > 0);
  if (!delivered.length) return 0;

  const known = await existingMap("ads", "account_id", account.id);
  const unknown = [...new Set(delivered.map((row) => row.dimensions.ad_id).filter((id) => !known.has(id)))];
  const creativeByAd = unknown.length ? await creativesOfAds(account, token, unknown) : new Map<string, string>();

  const day = (row: TikTokReportRow) => row.dimensions.stat_time_day.slice(0, 10);
  const adIds = await resolveReportedAds(
    account,
    "tiktok",
    delivered.map((row) => ({
      adId: row.dimensions.ad_id,
      adName: row.metrics.ad_name,
      adsetId: row.metrics.adgroup_id ?? "",
      adsetName: row.metrics.adgroup_name,
      campaignId: row.metrics.campaign_id ?? "",
      campaignName: row.metrics.campaign_name,
      date: day(row),
    })),
    creativeByAd,
  );

  const rows = delivered.flatMap((row) => {
    const adId = adIds.get(row.dimensions.ad_id);
    if (!adId) return [];
    const m = row.metrics;
    const plays = num(m.video_play_actions);
    return [
      {
        ad_id: adId,
        date: day(row),
        workspace_id: account.workspace_id,
        currency: account.currency,
        spend: num(m.spend),
        impressions: num(m.impressions),
        reach: num(m.reach),
        clicks: num(m.clicks),
        // Оплаты на сайте по данным пикселя TikTok и их сумма
        pixel_purchases: Math.round(num(m.complete_payment)),
        pixel_value: num(m.total_complete_payment_rate),
        // Результаты по цели оптимизации: для лид-кампаний это лиды по данным кабинета
        conversions: Math.round(num(m.conversion)),
        video_plays: plays,
        // У TikTok порог удержания — 2 и 6 секунд (у Meta 3 секунды и ThruPlay)
        video_3s: num(m.video_watched_2s),
        video_hold: num(m.video_watched_6s),
        video_watch_sec: num(m.average_video_play) * plays,
      },
    ];
  });
  return saveInsights(account, rows);
}

/** Скачивает обложки очередной порции креативов. Возвращает, сколько креативов осталось. */
export async function syncThumbnails(account: Account, token: string): Promise<{ done: number; remaining: number }> {
  const { pending, remaining } = await pendingThumbnails(account);
  const advertiser = { advertiser_id: account.external_id };

  const videoIds = pending.filter((creative) => creative.type === "video").map((creative) => creative.external_id);
  const videos = new Map<string, TikTokVideo>();
  if (videoIds.length) {
    const data = await tiktokGet<{ list?: TikTokVideo[] }>("/file/video/ad/info/", { ...advertiser, video_ids: videoIds }, token).catch(() => null);
    // Запрос не прошёл: креативы остаются в очереди до следующего обновления
    if (!data) return { done: 0, remaining: 0 };
    for (const video of data.list ?? []) videos.set(video.video_id, video);
  }

  await Promise.all(
    pending.map(async (creative) => {
      if (creative.type === "video") {
        const video = videos.get(creative.external_id);
        return storeThumbnail(account, creative.id, video?.video_cover_url, video?.duration ? { duration_sec: Math.round(video.duration) } : {});
      }
      if (creative.external_id.startsWith(NO_ASSET_PREFIX)) return storeThumbnail(account, creative.id);
      // Картинки спрашиваем по одной: если к одной нет доступа, TikTok отклоняет весь список
      const data = await tiktokGet<{ list?: { image_url?: string }[] }>("/file/image/ad/info/", { ...advertiser, image_ids: [creative.external_id] }, token).catch(() => null);
      return storeThumbnail(account, creative.id, data?.list?.[0]?.image_url);
    }),
  );
  return { done: pending.length, remaining };
}
