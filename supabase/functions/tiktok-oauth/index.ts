// Edge Function `tiktok-oauth`: подключение рекламных кабинетов TikTok Ads и их синхронизация.
// Общий порядок работы (вход, выбор кабинетов, шаги синхронизации, cron) — в ../_shared/server.ts.
// Функция только читает рекламу: ничего в кабинетах не меняет.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { HttpError, redirectUri } from "../_shared/core.ts";
import { type Grant, type RemoteAccount, serve } from "../_shared/server.ts";
import { chunk } from "../_shared/sync.ts";
import { AUTH_URL, TIKTOK_APP_ID, TIKTOK_APP_SECRET, tiktokGet, tiktokPost } from "./api.ts";
import { syncInsights, syncStructure, syncThumbnails } from "./sync.ts";

const ACTIVE_STATUS = "STATUS_ENABLE";
const ADVERTISER_FIELDS = ["advertiser_id", "name", "currency", "timezone", "status"];
const ADVERTISERS_PER_REQUEST = 100;

interface Advertiser {
  advertiser_id: string;
  name?: string;
  currency?: string;
  timezone?: string;
  status?: string;
}

function authUrl(state: string): string {
  const url = new URL(AUTH_URL);
  url.searchParams.set("app_id", TIKTOK_APP_ID);
  url.searchParams.set("state", state);
  url.searchParams.set("redirect_uri", redirectUri("tiktok"));
  return url.toString();
}

/** TikTok вернул браузер с кодом: меняем его на токен. Токен TikTok бессрочный, пока доступ не отозван. */
async function grant(url: URL): Promise<Grant> {
  const code = url.searchParams.get("auth_code") ?? url.searchParams.get("code");
  if (!code) throw new HttpError(400, "no_code", "TikTok не вернул код входа.");

  const access = await tiktokPost<{ access_token?: string; scope?: number[] }>("/oauth2/access_token/", {
    app_id: TIKTOK_APP_ID,
    secret: TIKTOK_APP_SECRET,
    auth_code: code,
  });
  if (!access.access_token) throw new HttpError(502, "platform_error", "TikTok не выдал токен доступа.");

  // Имя нужно только для подписи «кем подключено»: без него подключение тоже работает
  const user = await tiktokGet<{ core_user_id?: string; display_name?: string; email?: string }>("/user/info/", {}, access.access_token).catch(() => null);
  return {
    token: access.access_token,
    userId: user?.core_user_id ?? "",
    userName: user?.display_name || user?.email || "",
    scopes: (access.scope ?? []).map(String),
    expiresAt: null,
  };
}

async function listAccounts(token: string): Promise<RemoteAccount[]> {
  const granted = await tiktokGet<{ list?: { advertiser_id: string; advertiser_name?: string }[] }>(
    "/oauth2/advertiser/get/",
    { app_id: TIKTOK_APP_ID, secret: TIKTOK_APP_SECRET },
    token,
  );
  const advertisers = granted.list ?? [];

  // Валюта и часовой пояс приходят отдельным запросом
  const details = new Map<string, Advertiser>();
  for (const part of chunk(advertisers.map((a) => a.advertiser_id), ADVERTISERS_PER_REQUEST)) {
    const info = await tiktokGet<{ list?: Advertiser[] }>("/advertiser/info/", { advertiser_ids: part, fields: ADVERTISER_FIELDS }, token);
    for (const advertiser of info.list ?? []) details.set(advertiser.advertiser_id, advertiser);
  }

  return advertisers.map((a) => {
    const detail = details.get(a.advertiser_id);
    return {
      externalId: a.advertiser_id,
      name: detail?.name ?? a.advertiser_name ?? a.advertiser_id,
      currency: detail?.currency ?? "",
      timezone: detail?.timezone ?? "",
      active: detail?.status === ACTIVE_STATUS,
      externalStatus: null,
    };
  });
}

serve({
  platform: "tiktok",
  label: "TikTok",
  configured: () => Boolean(TIKTOK_APP_ID && TIKTOK_APP_SECRET),
  authUrl,
  grant,
  listAccounts,
  syncStructure,
  syncInsights,
  syncThumbnails,
});
