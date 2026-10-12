// Edge Function `meta-oauth`: подключение рекламных кабинетов Meta и их синхронизация.
//   GET  ?code&state — возврат из окна входа Facebook (браузер, без JWT)
//   POST {action}    — действия вошедшего пользователя (JWT проверяется здесь же)
//   POST {action:"cron"} + x-cron-secret — плановое обновление из pg_cron
// Функция только читает рекламу: ничего в кабинетах не меняет.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  admin,
  ALLOWED_ORIGINS,
  type Caller,
  connectionToken,
  CORS,
  DIALOG_URL,
  encryptToken,
  getCaller,
  graphGet,
  graphList,
  HttpError,
  json,
  markTokenExpired,
  META_APP_ID,
  META_APP_SECRET,
  META_LOGIN_CONFIG_ID,
  META_SCOPES,
  REDIRECT_URI,
  requireManager,
  requireMember,
  signState,
  verifyState,
} from "./lib.ts";
import { type Account, SUPPORTED_CURRENCIES, syncInsights, syncRates, syncStructure, syncThumbnails } from "./sync.ts";

const STATE_TTL_MS = 15 * 60_000;
const SECOND_MS = 1000;
const DAY_MS = 24 * 60 * 60 * SECOND_MS;
/** Плановое обновление перечитывает последние дни: Meta пересчитывает статистику задним числом. */
const CRON_LOOKBACK_DAYS = 3;
/** Запас до лимита времени Edge Function: дальше cron продолжит в следующий запуск. */
const CRON_BUDGET_MS = 110 * SECOND_MS;
const MAX_DETAIL_LENGTH = 200;
const META_ACTIVE_STATUS = 1;

const configured = () => Boolean(META_APP_ID && META_APP_SECRET);
const isoDay = (offsetDays = 0) => new Date(Date.now() - offsetDays * DAY_MS).toISOString().slice(0, 10);

interface State {
  w: string;
  u: string;
  o: string;
}

interface GraphAccount {
  id: string;
  name?: string;
  currency: string;
  timezone_name?: string;
  account_status?: number;
}

type Body = Record<string, unknown>;

// ---------- Вход через Facebook ----------

async function start(caller: Caller, body: Body) {
  const workspaceId = String(body.workspaceId ?? "");
  await requireManager(caller, workspaceId);
  if (!configured()) throw new HttpError(503, "meta_not_configured");
  const origin = String(body.origin ?? "");
  if (!ALLOWED_ORIGINS.includes(origin)) throw new HttpError(400, "origin_not_allowed");

  const url = new URL(DIALOG_URL);
  url.searchParams.set("client_id", META_APP_ID);
  url.searchParams.set("redirect_uri", REDIRECT_URI);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", await signState({ w: workspaceId, u: caller.id, o: origin, exp: Date.now() + STATE_TTL_MS }));
  if (META_LOGIN_CONFIG_ID) url.searchParams.set("config_id", META_LOGIN_CONFIG_ID);
  else url.searchParams.set("scope", META_SCOPES.join(","));
  return { url: url.toString() };
}

/** Facebook вернул браузер с кодом: меняем его на долгий токен и сохраняем зашифрованным. */
async function callback(url: URL): Promise<Response> {
  const state = await verifyState<State>(url.searchParams.get("state") ?? "");
  const origin = state && ALLOWED_ORIGINS.includes(state.o) ? state.o : ALLOWED_ORIGINS[0];
  const back = (result: string, detail = "") => {
    const target = new URL("/settings", origin);
    target.searchParams.set("meta", result);
    if (detail) target.searchParams.set("detail", detail.slice(0, MAX_DETAIL_LENGTH));
    return Response.redirect(target.toString(), 302);
  };

  if (!state) return back("error", "Ссылка входа устарела. Нажмите «Подключить Meta» ещё раз.");
  const denied = url.searchParams.get("error_description") ?? url.searchParams.get("error");
  if (denied) return back("error", denied);
  const code = url.searchParams.get("code");
  if (!code) return back("error", "Facebook не вернул код входа.");

  try {
    const app = { client_id: META_APP_ID, client_secret: META_APP_SECRET };
    const short = await graphGet<{ access_token: string }>("/oauth/access_token", { ...app, redirect_uri: REDIRECT_URI, code });
    const long = await graphGet<{ access_token: string; expires_in?: number }>("/oauth/access_token", {
      ...app,
      grant_type: "fb_exchange_token",
      fb_exchange_token: short.access_token,
    });
    const me = await graphGet<{ id: string; name?: string }>("/me", { fields: "id,name" }, long.access_token);

    const { data: connection, error } = await admin
      .from("ad_connections")
      .upsert(
        {
          workspace_id: state.w,
          platform: "meta",
          status: "active",
          external_user_id: me.id,
          external_user_name: me.name ?? "",
          scopes: META_SCOPES,
          token_expires_at: long.expires_in ? new Date(Date.now() + long.expires_in * SECOND_MS).toISOString() : null,
          connected_by: state.u,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "workspace_id,platform" },
      )
      .select("id")
      .single();
    if (error || !connection) throw new HttpError(500, "db_error", error?.message);

    const { error: secretError } = await admin.from("ad_connection_secrets").upsert({
      connection_id: connection.id,
      workspace_id: state.w,
      token_encrypted: await encryptToken(long.access_token),
      updated_at: new Date().toISOString(),
    });
    if (secretError) throw new HttpError(500, "db_error", secretError.message);

    await admin.from("ad_accounts").update({ status: "active" }).eq("connection_id", connection.id);
    await admin.from("audit_log").insert({ workspace_id: state.w, actor_id: state.u, action: "meta.connected", details: { meta_user: me.name ?? me.id } });
    return back("connected");
  } catch (error) {
    console.error("meta callback failed", error);
    return back("error", error instanceof HttpError ? (error.detail ?? error.code) : "Не удалось завершить вход.");
  }
}

// ---------- Кабинеты ----------

const ACCOUNT_FIELDS = "id,name,currency,timezone_name,account_status";

async function listAccounts(caller: Caller, body: Body) {
  const workspaceId = String(body.workspaceId ?? "");
  await requireManager(caller, workspaceId);
  const { token } = await connectionToken(workspaceId);
  const [available, { data: saved }] = await Promise.all([
    graphList<GraphAccount>("/me/adaccounts", { fields: ACCOUNT_FIELDS, limit: "200" }, token),
    admin.from("ad_accounts").select("external_id, selected").eq("workspace_id", workspaceId).eq("platform", "meta"),
  ]);
  const selected = new Set((saved ?? []).filter((a) => a.selected).map((a) => a.external_id));
  return {
    accounts: available.map((a) => ({
      externalId: a.id,
      name: a.name ?? a.id,
      currency: a.currency,
      timezone: a.timezone_name ?? "",
      active: a.account_status === META_ACTIVE_STATUS,
      // Отчёты считаются в USD и KZT: кабинеты в других валютах пока не подключаются
      supported: SUPPORTED_CURRENCIES.includes(a.currency),
      selected: selected.has(a.id),
    })),
  };
}

async function selectAccounts(caller: Caller, body: Body) {
  const workspaceId = String(body.workspaceId ?? "");
  await requireManager(caller, workspaceId);
  const wanted = new Set(Array.isArray(body.accounts) ? body.accounts.map(String) : []);
  const { connectionId, token } = await connectionToken(workspaceId);

  // Названия и валюту берём у Meta, а не из запроса браузера
  const available = await graphList<GraphAccount>("/me/adaccounts", { fields: ACCOUNT_FIELDS, limit: "200" }, token);
  const chosen = available.filter((a) => wanted.has(a.id) && SUPPORTED_CURRENCIES.includes(a.currency));

  await admin.from("ad_accounts").update({ selected: false }).eq("workspace_id", workspaceId).eq("platform", "meta");
  if (chosen.length) {
    const { error } = await admin.from("ad_accounts").upsert(
      chosen.map((a) => ({
        workspace_id: workspaceId,
        connection_id: connectionId,
        platform: "meta",
        external_id: a.id,
        name: a.name ?? a.id,
        currency: a.currency,
        timezone: a.timezone_name ?? "Asia/Almaty",
        external_status: a.account_status ?? null,
        status: "active",
        selected: true,
      })),
      { onConflict: "workspace_id,platform,external_id" },
    );
    if (error) throw new HttpError(500, "db_error", error.message);
    // С первым настоящим кабинетом демо-данные больше не показываем
    await admin.from("workspaces").update({ demo_data: false }).eq("id", workspaceId);
  }
  const { data: accounts } = await admin.from("ad_accounts").select("id, name").eq("workspace_id", workspaceId).eq("platform", "meta").eq("selected", true);
  return { accounts: accounts ?? [] };
}

async function disconnect(caller: Caller, body: Body) {
  const workspaceId = String(body.workspaceId ?? "");
  await requireManager(caller, workspaceId);
  const { data: connection } = await admin.from("ad_connections").select("id").eq("workspace_id", workspaceId).eq("platform", "meta").maybeSingle();
  if (!connection) throw new HttpError(404, "not_connected");
  // Токен удаляем, загруженная статистика остаётся
  await admin.from("ad_connection_secrets").delete().eq("connection_id", connection.id);
  await admin.from("ad_connections").update({ status: "disconnected", updated_at: new Date().toISOString() }).eq("id", connection.id);
  await admin.from("audit_log").insert({ workspace_id: workspaceId, actor_id: caller.id, action: "meta.disconnected", details: {} });
  return { ok: true };
}

// ---------- Синхронизация ----------

async function loadAccount(workspaceId: string, accountId: string): Promise<Account> {
  const { data } = await admin
    .from("ad_accounts")
    .select("id, workspace_id, external_id, currency")
    .eq("id", accountId)
    .eq("workspace_id", workspaceId)
    .eq("platform", "meta")
    .maybeSingle();
  if (!data) throw new HttpError(404, "account_not_found");
  return data;
}

/** Один шаг синхронизации. Ошибку токена превращает в статус «нужно переподключить». */
async function runStep(workspaceId: string, step: string, body: Body, token: string): Promise<Record<string, unknown>> {
  const since = String(body.since ?? isoDay(CRON_LOOKBACK_DAYS));
  const until = String(body.until ?? isoDay());
  try {
    if (step === "rates") return { rows: await syncRates(since, until) };
    const account = await loadAccount(workspaceId, String(body.accountId ?? ""));
    if (step === "structure") return { rows: await syncStructure(account, token) };
    if (step === "insights") return { rows: await syncInsights(account, token, since, until) };
    if (step === "thumbnails") return await syncThumbnails(account, token);
    throw new HttpError(400, "unknown_step");
  } catch (error) {
    if (error instanceof HttpError && error.code === "meta_token_expired") await markTokenExpired(workspaceId);
    throw error;
  }
}

async function syncStep(caller: Caller, body: Body) {
  const workspaceId = String(body.workspaceId ?? "");
  await requireMember(caller, workspaceId);
  const step = String(body.step ?? "");

  // Журнал: начало и конец полной синхронизации кабинета
  if (step === "begin") {
    const account = await loadAccount(workspaceId, String(body.accountId ?? ""));
    const { data } = await admin.from("sync_runs").insert({ workspace_id: workspaceId, account_id: account.id, status: "running" }).select("id").single();
    return { runId: data?.id ?? null };
  }
  if (step === "finish") {
    const error = body.error ? String(body.error).slice(0, MAX_DETAIL_LENGTH) : null;
    await admin
      .from("sync_runs")
      .update({ status: error ? "error" : "success", finished_at: new Date().toISOString(), rows: Number(body.rows ?? 0) || 0, error })
      .eq("id", String(body.runId ?? ""))
      .eq("workspace_id", workspaceId);
    return { ok: true };
  }
  const { token } = await connectionToken(workspaceId);
  return runStep(workspaceId, step, body, token);
}

/** Плановое обновление всех подключённых кабинетов. Вызывает pg_cron. */
async function cron(req: Request) {
  const { data: secret } = await admin.from("app_secrets").select("value").eq("name", "cron_secret").maybeSingle();
  if (!secret?.value || req.headers.get("x-cron-secret") !== secret.value) throw new HttpError(401, "unauthorized");

  const startedAt = Date.now();
  const since = isoDay(CRON_LOOKBACK_DAYS);
  const until = isoDay();
  await syncRates(since, until);

  const { data: accounts } = await admin
    .from("ad_accounts")
    .select("id, workspace_id, external_id, currency, ad_connections!inner(status)")
    .eq("platform", "meta")
    .eq("selected", true)
    .eq("ad_connections.status", "active")
    .order("last_synced_at", { ascending: true, nullsFirst: true });

  const tokens = new Map<string, string>();
  let synced = 0;
  for (const account of accounts ?? []) {
    if (Date.now() - startedAt > CRON_BUDGET_MS) break;
    const { data: run } = await admin.from("sync_runs").insert({ workspace_id: account.workspace_id, account_id: account.id, status: "running" }).select("id").single();
    let rows = 0;
    let failure: string | null = null;
    try {
      if (!tokens.has(account.workspace_id)) tokens.set(account.workspace_id, (await connectionToken(account.workspace_id)).token);
      const token = tokens.get(account.workspace_id)!;
      rows += await syncStructure(account, token);
      rows += await syncInsights(account, token, since, until);
      await syncThumbnails(account, token);
      synced += 1;
    } catch (error) {
      failure = error instanceof HttpError ? (error.detail ?? error.code) : String(error);
      if (error instanceof HttpError && error.code === "meta_token_expired") await markTokenExpired(account.workspace_id);
    }
    if (run) {
      await admin
        .from("sync_runs")
        .update({ status: failure ? "error" : "success", finished_at: new Date().toISOString(), rows, error: failure?.slice(0, MAX_DETAIL_LENGTH) ?? null })
        .eq("id", run.id);
    }
  }
  return { accounts: accounts?.length ?? 0, synced };
}

const ACTIONS: Record<string, (caller: Caller, body: Body) => Promise<unknown>> = {
  start,
  accounts: listAccounts,
  select_accounts: selectAccounts,
  disconnect,
  sync_step: syncStep,
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    if (req.method === "GET") {
      const url = new URL(req.url);
      if (url.searchParams.has("state") || url.searchParams.has("code") || url.searchParams.has("error")) return await callback(url);
      // Проверка настройки: заданы ли ключи приложения Meta. Сами ключи не раскрываются.
      return json({ configured: configured() });
    }
    if (req.method !== "POST") throw new HttpError(405, "method_not_allowed");
    const body = (await req.json().catch(() => ({}))) as Body;
    const name = String(body.action ?? "");
    if (name === "cron") return json(await cron(req));
    const action = ACTIONS[name];
    if (!action) throw new HttpError(400, "unknown_action");
    return json(await action(await getCaller(req), body));
  } catch (error) {
    if (error instanceof HttpError) return json({ error: error.code, detail: error.detail }, error.status);
    console.error(error);
    return json({ error: "internal" }, 500);
  }
});
