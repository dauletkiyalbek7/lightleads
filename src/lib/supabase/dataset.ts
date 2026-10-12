import { APP, HISTORY_DAYS } from "@/lib/config";
import { addDays } from "@/lib/dates";
import type {
  Ad,
  AdAccount,
  AdConnection,
  AdSet,
  Campaign,
  Creative,
  Currency,
  Dataset,
  EntityStatus,
  InsightDaily,
  Objective,
  Platform,
  SyncRun,
} from "@/lib/types";
import { getBrowserSupabase } from "./client";
import { SUPABASE_URL } from "./env";

/** PostgREST отдаёт не больше 1000 строк за запрос: большие таблицы читаем страницами. */
const PAGE_SIZE = 1000;
const MAX_PAGES = 200;
/** Период сравнения — такой же длины, как выбранный, поэтому история нужна вдвое глубже. */
const LOOKBACK_DAYS = HISTORY_DAYS * 2;
const SYNC_RUNS_SHOWN = 12;
const HUE_RANGE = 360;
const MS_IN_SECOND = 1000;
const STAMP_LENGTH = 16;
const DEFAULT_OBJECTIVE: Objective = "awareness";
const STORAGE_PUBLIC_URL = `${SUPABASE_URL}/storage/v1/object/public/creatives`;

interface AccountRow {
  id: string;
  platform: Platform;
  name: string;
  external_id: string;
  currency: Currency;
  timezone: string;
  status: AdAccount["status"];
  last_synced_at: string | null;
}
interface CampaignRow {
  id: string;
  account_id: string;
  platform: Platform;
  name: string;
  objective: Objective | null;
  status: EntityStatus;
  daily_budget: number | null;
}
interface AdSetRow {
  id: string;
  campaign_id: string;
  name: string;
  status: EntityStatus;
}
interface AdRow {
  id: string;
  adset_id: string;
  campaign_id: string;
  account_id: string;
  platform: Platform;
  name: string;
  status: EntityStatus;
  creative_id: string | null;
  start_date: string | null;
  end_date: string | null;
}
interface CreativeRow {
  id: string;
  name: string;
  type: Creative["type"];
  title: string;
  body: string;
  cta: string;
  thumbnail_path: string | null;
  duration_sec: number | null;
}
interface InsightRow {
  ad_id: string;
  date: string;
  currency: Currency;
  spend: number;
  impressions: number;
  reach: number;
  clicks: number;
  pixel_purchases: number;
  pixel_value: number;
  video_plays: number;
  video_3s: number;
  video_hold: number;
  video_watch_sec: number;
}
interface SyncRunRow {
  id: string;
  account_id: string;
  status: "running" | "success" | "error";
  started_at: string;
  finished_at: string | null;
  rows: number;
  error: string | null;
}
interface ConnectionRow {
  platform: Platform;
  status: AdConnection["status"];
  external_user_name: string | null;
}

/** Читает все строки таблицы workspace постранично. */
async function fetchAll<T>(table: string, columns: string, workspaceId: string, order: string, since?: string): Promise<T[]> {
  const rows: T[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    let query = getBrowserSupabase().from(table).select(columns).eq("workspace_id", workspaceId);
    if (since) query = query.gte("date", since);
    const { data, error } = await query
      .order(order)
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)
      .returns<T[]>();
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...(data ?? []));
    if ((data?.length ?? 0) < PAGE_SIZE) break;
  }
  return rows;
}

/** Время запуска в часовом поясе приложения, «ГГГГ-ММ-ДД ЧЧ:ММ» — как в журнале синхронизаций. */
const localStamp = (iso: string) => new Date(iso).toLocaleString("sv-SE", { timeZone: APP.timezone }).slice(0, STAMP_LENGTH);

/** Стабильный оттенок обложки из идентификатора: пока превью не скачано, показываем градиент. */
function hueOf(id: string): number {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) % HUE_RANGE;
  return hash;
}

export interface WorkspaceData {
  dataset: Dataset;
  connections: AdConnection[];
  /** Время последней синхронизации, мс; 0 — ещё не было. */
  lastSyncedAt: number;
}

/**
 * Данные подключённых кабинетов из Supabase в том же виде, что и демо-набор:
 * экраны и расчёты от источника не зависят. Лиды и продажи появятся в Фазах 4–5.
 */
export async function loadWorkspaceData(workspaceId: string, today: string): Promise<WorkspaceData> {
  const supabase = getBrowserSupabase();
  const since = addDays(today, -LOOKBACK_DAYS);

  const [accountRows, campaignRows, adsetRows, adRows, creativeRows, insightRows, rates, runs, connections] = await Promise.all([
    fetchAll<AccountRow>("ad_accounts", "id, platform, name, external_id, currency, timezone, status, last_synced_at, selected", workspaceId, "created_at"),
    fetchAll<CampaignRow>("campaigns", "id, account_id, platform, name, objective, status, daily_budget", workspaceId, "id"),
    fetchAll<AdSetRow>("adsets", "id, campaign_id, name, status", workspaceId, "id"),
    fetchAll<AdRow>("ads", "id, adset_id, campaign_id, account_id, platform, name, status, creative_id, start_date, end_date", workspaceId, "id"),
    fetchAll<CreativeRow>("creatives", "id, name, type, title, body, cta, thumbnail_path, duration_sec", workspaceId, "id"),
    fetchAll<InsightRow>(
      "insights_daily",
      "ad_id, date, currency, spend, impressions, reach, clicks, pixel_purchases, pixel_value, video_plays, video_3s, video_hold, video_watch_sec",
      workspaceId,
      "date",
      since,
    ),
    supabase.from("exchange_rates").select("date, usd_kzt").gte("date", since).order("date").returns<{ date: string; usd_kzt: number }[]>(),
    supabase
      .from("sync_runs")
      .select("id, account_id, status, started_at, finished_at, rows, error")
      .eq("workspace_id", workspaceId)
      .neq("status", "running")
      .order("started_at", { ascending: false })
      .limit(SYNC_RUNS_SHOWN)
      .returns<SyncRunRow[]>(),
    supabase.from("ad_connections").select("platform, status, external_user_name").eq("workspace_id", workspaceId).returns<ConnectionRow[]>(),
  ]);

  // Показываем только кабинеты, отмеченные пользователем
  const selected = (accountRows as (AccountRow & { selected: boolean })[]).filter((a) => a.selected);
  const accountIds = new Set(selected.map((a) => a.id));
  const accounts: AdAccount[] = selected.map((a) => ({
    id: a.id,
    platform: a.platform,
    name: a.name,
    externalId: a.external_id,
    currency: a.currency,
    timezone: a.timezone,
    status: a.status,
  }));

  const campaigns: Campaign[] = campaignRows
    .filter((c) => accountIds.has(c.account_id))
    .map((c) => ({
      id: c.id,
      accountId: c.account_id,
      platform: c.platform,
      name: c.name,
      objective: c.objective ?? DEFAULT_OBJECTIVE,
      status: c.status,
      dailyBudget: Number(c.daily_budget ?? 0),
    }));
  const campaignIds = new Set(campaigns.map((c) => c.id));
  const adsets: AdSet[] = adsetRows.filter((a) => campaignIds.has(a.campaign_id)).map((a) => ({ id: a.id, campaignId: a.campaign_id, name: a.name, status: a.status }));

  const creatives = new Map<string, Creative>(
    creativeRows.map((c) => [
      c.id,
      {
        id: c.id,
        name: c.name,
        type: c.type,
        title: c.title,
        body: c.body,
        cta: c.cta,
        hue: hueOf(c.id),
        durationSec: c.duration_sec,
        thumbnailUrl: c.thumbnail_path ? `${STORAGE_PUBLIC_URL}/${c.thumbnail_path}` : undefined,
      },
    ]),
  );

  const ads: Ad[] = adRows
    .filter((a) => accountIds.has(a.account_id))
    .map((a) => {
      // У архивных объявлений Meta не отдаёт креатив: показываем объявление с обложкой-заглушкой
      let creativeId = a.creative_id && creatives.has(a.creative_id) ? a.creative_id : null;
      if (!creativeId) {
        creativeId = `ad-${a.id}`;
        creatives.set(creativeId, { id: creativeId, name: a.name, type: "image", title: "", body: "", cta: "", hue: hueOf(a.id), durationSec: null });
      }
      return {
        id: a.id,
        adsetId: a.adset_id,
        campaignId: a.campaign_id,
        accountId: a.account_id,
        platform: a.platform,
        name: a.name,
        status: a.status,
        creativeId,
        startDate: a.start_date ?? since,
        endDate: a.end_date,
      };
    });
  const adIds = new Set(ads.map((a) => a.id));
  const usedCreatives = new Set(ads.map((a) => a.creativeId));

  const insights: InsightDaily[] = insightRows
    .filter((row) => adIds.has(row.ad_id))
    .map((row) => ({
      adId: row.ad_id,
      date: row.date,
      currency: row.currency,
      spend: Number(row.spend),
      impressions: Number(row.impressions),
      reach: Number(row.reach),
      clicks: Number(row.clicks),
      pixelPurchases: Number(row.pixel_purchases),
      pixelValue: Number(row.pixel_value),
      videoPlays: Number(row.video_plays),
      video3s: Number(row.video_3s),
      videoHold: Number(row.video_hold),
      videoWatchSec: Number(row.video_watch_sec),
    }));

  const syncRuns: SyncRun[] = (runs.data ?? []).flatMap((run) =>
    run.status === "running"
      ? []
      : [
          {
            id: run.id,
            accountId: run.account_id,
            status: run.status,
            startedAt: localStamp(run.started_at),
            durationSec: run.finished_at ? Math.round((Date.parse(run.finished_at) - Date.parse(run.started_at)) / MS_IN_SECOND) : 0,
            rows: run.rows,
            error: run.error,
          },
        ],
  );

  return {
    dataset: {
      today,
      accounts,
      campaigns,
      adsets,
      ads,
      creatives: [...creatives.values()].filter((c) => usedCreatives.has(c.id)),
      insights,
      leads: [],
      products: [],
      sales: [],
      rates: Object.fromEntries((rates.data ?? []).map((row) => [row.date, Number(row.usd_kzt)])),
      members: [],
      syncRuns,
    },
    connections: (connections.data ?? []).map((c) => ({ platform: c.platform, status: c.status, userName: c.external_user_name ?? "" })),
    lastSyncedAt: Math.max(0, ...selected.map((a) => (a.last_synced_at ? Date.parse(a.last_synced_at) : 0))),
  };
}
