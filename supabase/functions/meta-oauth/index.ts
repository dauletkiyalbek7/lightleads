// Edge Function `meta-oauth`: подключение рекламных кабинетов Meta и их синхронизация.
// Общий порядок работы (вход, выбор кабинетов, шаги синхронизации, cron) — в ../_shared/server.ts.
// Функция только читает рекламу: ничего в кабинетах не меняет.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { HttpError, redirectUri } from "../_shared/core.ts";
import { type Grant, type RemoteAccount, serve } from "../_shared/server.ts";
import { DIALOG_URL, graphGet, graphList, META_APP_ID, META_APP_SECRET, META_LOGIN_CONFIG_ID, META_SCOPES } from "./lib.ts";
import { syncInsights, syncStructure, syncThumbnails } from "./sync.ts";

const SECOND_MS = 1000;
const META_ACTIVE_STATUS = 1;
const ACCOUNT_FIELDS = "id,name,currency,timezone_name,account_status";
const REDIRECT_URI = redirectUri("meta");

interface GraphAccount {
  id: string;
  name?: string;
  currency: string;
  timezone_name?: string;
  account_status?: number;
}

function authUrl(state: string): string {
  const url = new URL(DIALOG_URL);
  url.searchParams.set("client_id", META_APP_ID);
  url.searchParams.set("redirect_uri", REDIRECT_URI);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", state);
  if (META_LOGIN_CONFIG_ID) url.searchParams.set("config_id", META_LOGIN_CONFIG_ID);
  else url.searchParams.set("scope", META_SCOPES.join(","));
  return url.toString();
}

/** Права, которые пользователь действительно выдал приложению. */
async function grantedScopes(token: string): Promise<string[]> {
  const { data } = await graphGet<{ data?: { permission: string; status: string }[] }>("/me/permissions", {}, token);
  return (data ?? []).filter((p) => p.status === "granted").map((p) => p.permission);
}

/** Facebook вернул браузер с кодом: меняем его на долгий токен. */
async function grant(url: URL): Promise<Grant> {
  const denied = url.searchParams.get("error_description") ?? url.searchParams.get("error");
  if (denied) throw new HttpError(400, "denied", denied);
  const code = url.searchParams.get("code");
  if (!code) throw new HttpError(400, "no_code", "Facebook не вернул код входа.");

  const app = { client_id: META_APP_ID, client_secret: META_APP_SECRET };
  const short = await graphGet<{ access_token: string }>("/oauth/access_token", { ...app, redirect_uri: REDIRECT_URI, code });
  const long = await graphGet<{ access_token: string; expires_in?: number }>("/oauth/access_token", {
    ...app,
    grant_type: "fb_exchange_token",
    fb_exchange_token: short.access_token,
  });
  const me = await graphGet<{ id: string; name?: string }>("/me", { fields: "id,name" }, long.access_token);
  const scopes = await grantedScopes(long.access_token);
  if (!META_SCOPES.every((scope) => scopes.includes(scope))) {
    throw new HttpError(400, "scope_missing", "Facebook не выдал право на чтение рекламы (ads_read). Добавьте его в приложении Meta и подключите заново.");
  }
  return {
    token: long.access_token,
    userId: me.id,
    userName: me.name ?? "",
    scopes,
    expiresAt: long.expires_in ? new Date(Date.now() + long.expires_in * SECOND_MS).toISOString() : null,
  };
}

async function listAccounts(token: string): Promise<RemoteAccount[]> {
  const accounts = await graphList<GraphAccount>("/me/adaccounts", { fields: ACCOUNT_FIELDS, limit: "200" }, token);
  return accounts.map((a) => ({
    externalId: a.id,
    name: a.name ?? a.id,
    currency: a.currency,
    timezone: a.timezone_name ?? "",
    active: a.account_status === META_ACTIVE_STATUS,
    externalStatus: a.account_status ?? null,
  }));
}

serve({
  platform: "meta",
  label: "Meta",
  configured: () => Boolean(META_APP_ID && META_APP_SECRET),
  authUrl,
  grant,
  listAccounts,
  syncStructure,
  syncInsights,
  syncThumbnails,
});
