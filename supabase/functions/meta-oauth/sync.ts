// Синхронизация Meta: структура кабинета, статистика по дням и превью креативов.
// Структура и статистика читаются по одной странице за вызов: в большом кабинете тысячи объявлений,
// и целиком он не укладывается в лимит времени Edge Functions.
import { type Account, idsByExternal, now, num, pendingThumbnails, type Progress, resolveReportedAds, saveInsights, storeThumbnail, upsertMap } from "../_shared/sync.ts";
import { graphGet, graphPage } from "./lib.ts";

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

/** Обход структуры идёт по частям в этом порядке: группам нужны кампании, объявлениям — группы. */
const PARTS = ["campaigns", "adsets", "ads"] as const;
type Part = (typeof PARTS)[number];
/** Место остановки записывается как «часть:метка страницы». */
const CURSOR_SEPARATOR = ":";
// Креатив приходит вложенным в объявление: запрос нескольких объектов по ?ids= в v26.0 отключён
const QUERY: Record<Part, Record<string, string>> = {
  campaigns: { fields: "id,name,objective,effective_status,daily_budget", limit: "500" },
  adsets: { fields: "id,name,campaign_id,effective_status", limit: "500" },
  ads: { fields: "id,name,adset_id,campaign_id,effective_status,created_time,creative{id,name,title,body,video_id,object_type,call_to_action_type}", limit: "200" },
};

const base = (account: Account) => ({ workspace_id: account.workspace_id, updated_at: now() });

async function saveCampaigns(account: Account, campaigns: GraphCampaign[]): Promise<number> {
  await upsertMap(
    "campaigns",
    campaigns.map((c) => ({
      ...base(account),
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
  return campaigns.length;
}

async function saveAdSets(account: Account, adsets: GraphAdSet[]): Promise<number> {
  const campaignIds = await idsByExternal("campaigns", "account_id", account.id, adsets.map((a) => a.campaign_id));
  const rows = adsets.flatMap((a) => {
    const campaignId = campaignIds.get(a.campaign_id);
    return campaignId ? [{ ...base(account), campaign_id: campaignId, external_id: a.id, name: a.name ?? a.id, status: status(a.effective_status) }] : [];
  });
  await upsertMap("adsets", rows, "campaign_id,external_id");
  return rows.length;
}

async function saveAds(account: Account, ads: GraphAd[]): Promise<number> {
  const [campaignIds, adsetIds] = await Promise.all([
    idsByExternal("campaigns", "account_id", account.id, ads.map((ad) => ad.campaign_id)),
    idsByExternal("adsets", "workspace_id", account.workspace_id, ads.map((ad) => ad.adset_id)),
  ]);
  const creatives = [...new Map(ads.flatMap((ad) => (ad.creative?.id ? [[ad.creative.id, ad.creative] as const] : []))).values()];
  const adNameByCreative = new Map(ads.flatMap((ad) => (ad.creative?.id ? [[ad.creative.id, ad.name ?? ""] as const] : [])));
  const creativeIds = await upsertMap(
    "creatives",
    creatives.map((c) => ({
      ...base(account),
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
        ...base(account),
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
  return adRows.length + creatives.length;
}

/** Непонятное место остановки (например, от старой версии) — начинаем обход с начала. */
function parseCursor(cursor: string | null): { part: Part; after: string } {
  const index = cursor?.indexOf(CURSOR_SEPARATOR) ?? -1;
  const part = PARTS.find((name) => name === cursor?.slice(0, index));
  return part && cursor ? { part, after: cursor.slice(index + 1) } : { part: PARTS[0], after: "" };
}

/** Одна страница структуры кабинета: кампании, затем группы, затем объявления с креативами. */
export async function syncStructure(account: Account, token: string, cursor: string | null): Promise<Progress> {
  const { part, after } = parseCursor(cursor);
  const path = `/${account.external_id}/${part}`;
  let rows: number;
  let next: string | null;
  if (part === "campaigns") {
    const page = await graphPage<GraphCampaign>(path, QUERY[part], token, after);
    [rows, next] = [await saveCampaigns(account, page.data), page.after];
  } else if (part === "adsets") {
    const page = await graphPage<GraphAdSet>(path, QUERY[part], token, after);
    [rows, next] = [await saveAdSets(account, page.data), page.after];
  } else {
    const page = await graphPage<GraphAd>(path, QUERY[part], token, after);
    [rows, next] = [await saveAds(account, page.data), page.after];
  }
  if (next) return { rows, cursor: `${part}${CURSOR_SEPARATOR}${next}` };
  const following = PARTS[PARTS.indexOf(part) + 1];
  return { rows, cursor: following ? `${following}${CURSOR_SEPARATOR}` : null };
}

const INSIGHT_FIELDS =
  "ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,spend,impressions,reach,clicks,inline_link_clicks,actions,action_values,video_play_actions,video_thruplay_watched_actions,video_avg_time_watched_actions";

/** Одна страница статистики «объявление × день» за период. */
export async function syncInsights(account: Account, token: string, since: string, until: string, cursor: string | null): Promise<Progress> {
  const page = await graphPage<GraphInsight>(
    `/${account.external_id}/insights`,
    { level: "ad", time_increment: "1", time_range: JSON.stringify({ since, until }), fields: INSIGHT_FIELDS, limit: "500" },
    token,
    cursor,
  );
  const insights = page.data;
  if (!insights.length) return { rows: 0, cursor: page.after };

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
  return { rows: await saveInsights(account, rows), cursor: page.after };
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
