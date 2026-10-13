// Синхронизация Meta: структура кабинета, статистика по дням и превью креативов.
// Каждый шаг — отдельный короткий вызов, чтобы уложиться в лимиты Edge Functions
// и показывать пользователю прогресс первой загрузки.
import { admin } from "../_shared/core.ts";
import { type Account, now, num, pendingThumbnails, resolveReportedAds, saveInsights, storeThumbnail, upsertMap } from "../_shared/sync.ts";
import { graphGet, graphList } from "./lib.ts";

const THUMBNAIL_SIZE = { thumbnail_width: "600", thumbnail_height: "750" };
/** Meta отдаёт бюджеты в минимальных единицах валюты (центы, тиыны). */
const BUDGET_DIVISOR = 100;

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

/** Статистика «объявление × день» за период. */
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

  const adIds = await resolveReportedAds(
    account,
    "meta",
    insights.map((row) => ({
      adId: row.ad_id,
      adName: row.ad_name,
      adsetId: row.adset_id,
      adsetName: row.adset_name,
      campaignId: row.campaign_id,
      campaignName: row.campaign_name,
      date: row.date_start,
    })),
  );

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
  return saveInsights(account, rows);
}

/** Скачивает превью очередной порции креативов. Возвращает, сколько креативов осталось. */
export async function syncThumbnails(account: Account, token: string): Promise<{ done: number; remaining: number }> {
  const { pending, remaining } = await pendingThumbnails(account);
  await Promise.all(
    pending.map(async (creative) => {
      // Свежую ссылку на превью спрашиваем у каждого креатива отдельно; сбой одного не мешает остальным
      const source = await graphGet<GraphCreative>(`/${creative.external_id}`, { fields: "thumbnail_url,image_url", ...THUMBNAIL_SIZE }, token).catch(() => null);
      await storeThumbnail(account, creative.id, source?.thumbnail_url ?? source?.image_url);
    }),
  );
  return { done: pending.length, remaining };
}
