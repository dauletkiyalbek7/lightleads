// Общий каркас функции подключения рекламной платформы. Одинаковый для Meta и TikTok:
//   GET  ?state&…      — возврат из окна входа платформы (браузер, без JWT)
//   POST {action}      — действия вошедшего пользователя (JWT проверяется здесь же)
//   POST {action:"cron"} + x-cron-secret — плановое обновление из pg_cron
// Отличия платформ (адреса, поля, обмен кода на токен) описывает Driver.
import {
  admin,
  ALLOWED_ORIGINS,
  type Caller,
  connectionToken,
  CORS,
  encryptToken,
  getCaller,
  HttpError,
  json,
  markTokenExpired,
  type Platform,
  requireManager,
  requireMember,
  signState,
  TOKEN_EXPIRED,
  verifyState,
} from "./core.ts";
import { type Account, SUPPORTED_CURRENCIES, syncRates } from "./sync.ts";

const STATE_TTL_MS = 15 * 60_000;
const SECOND_MS = 1000;
const DAY_MS = 24 * 60 * 60 * SECOND_MS;
/** Плановое обновление перечитывает последние дни: платформы пересчитывают статистику задним числом. */
const CRON_LOOKBACK_DAYS = 3;
/** Наибольшая глубина догрузки истории и размер одного запроса статистики, дней. */
const MAX_LOOKBACK_DAYS = 90;
const INSIGHTS_WINDOW_DAYS = 10;
/** Запас до лимита времени Edge Function: дальше cron продолжит в следующий запуск. */
const CRON_BUDGET_MS = 110 * SECOND_MS;
const MAX_DETAIL_LENGTH = 200;
const DEFAULT_TIMEZONE = "Asia/Almaty";
/** Параметры адреса, по которым виден возврат из окна входа. */
const CALLBACK_PARAMS = ["state", "code", "auth_code", "error"];

/** Рекламный кабинет, как его отдаёт платформа. */
export interface RemoteAccount {
  externalId: string;
  name: string;
  currency: string;
  timezone: string;
  active: boolean;
  /** Числовой статус кабинета на платформе, если он есть. */
  externalStatus: number | null;
}

/** Результат входа: токен и то, чей он. */
export interface Grant {
  token: string;
  userId: string;
  userName: string;
  scopes: string[];
  expiresAt: string | null;
}

export interface Driver {
  platform: Platform;
  /** Название платформы для сообщений пользователю. */
  label: string;
  /** Заданы ли ключи приложения платформы. */
  configured(): boolean;
  /** Адрес окна входа. */
  authUrl(state: string): string;
  /** Обмен параметров возврата на токен. Отказ пользователя — HttpError с пояснением в detail. */
  grant(url: URL): Promise<Grant>;
  listAccounts(token: string): Promise<RemoteAccount[]>;
  syncStructure(account: Account, token: string): Promise<number>;
  syncInsights(account: Account, token: string, since: string, until: string): Promise<number>;
  syncThumbnails(account: Account, token: string): Promise<{ done: number; remaining: number }>;
}

interface State {
  w: string;
  u: string;
  o: string;
}

type Body = Record<string, unknown>;

const isoDay = (offsetDays = 0) => new Date(Date.now() - offsetDays * DAY_MS).toISOString().slice(0, 10);

/** Период «последние days дней» окнами от свежих к старым. */
function insightWindows(days: number): { since: string; until: string }[] {
  const windows = [];
  for (let offset = 0; offset < days; offset += INSIGHTS_WINDOW_DAYS) {
    windows.push({ since: isoDay(Math.min(offset + INSIGHTS_WINDOW_DAYS, days) - 1), until: isoDay(offset) });
  }
  return windows;
}

/** Запускает функцию подключения для платформы. */
export function serve(driver: Driver) {
  const { platform, label } = driver;

  // ---------- Вход ----------

  async function start(caller: Caller, body: Body) {
    const workspaceId = String(body.workspaceId ?? "");
    await requireManager(caller, workspaceId);
    if (!driver.configured()) throw new HttpError(503, "not_configured");
    const origin = String(body.origin ?? "");
    if (!ALLOWED_ORIGINS.includes(origin)) throw new HttpError(400, "origin_not_allowed");
    return { url: driver.authUrl(await signState({ w: workspaceId, u: caller.id, o: origin, exp: Date.now() + STATE_TTL_MS })) };
  }

  /** Платформа вернула браузер: меняем код на токен и сохраняем его зашифрованным. */
  async function callback(url: URL): Promise<Response> {
    const state = await verifyState<State>(url.searchParams.get("state") ?? "");
    const origin = state && ALLOWED_ORIGINS.includes(state.o) ? state.o : ALLOWED_ORIGINS[0];
    const back = (result: string, detail = "") => {
      const target = new URL("/settings", origin);
      target.searchParams.set(platform, result);
      if (detail) target.searchParams.set("detail", detail.slice(0, MAX_DETAIL_LENGTH));
      return Response.redirect(target.toString(), 302);
    };
    if (!state) return back("error", `Ссылка входа устарела. Нажмите «Подключить ${label}» ещё раз.`);

    try {
      const grant = await driver.grant(url);
      const { data: connection, error } = await admin
        .from("ad_connections")
        .upsert(
          {
            workspace_id: state.w,
            platform,
            status: "active",
            external_user_id: grant.userId,
            external_user_name: grant.userName,
            scopes: grant.scopes,
            token_expires_at: grant.expiresAt,
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
        token_encrypted: await encryptToken(grant.token),
        updated_at: new Date().toISOString(),
      });
      if (secretError) throw new HttpError(500, "db_error", secretError.message);

      await admin.from("ad_accounts").update({ status: "active" }).eq("connection_id", connection.id);
      await admin.from("audit_log").insert({ workspace_id: state.w, actor_id: state.u, action: `${platform}.connected`, details: { user: grant.userName || grant.userId } });
      return back("connected");
    } catch (error) {
      console.error(`${platform} callback failed`, error);
      return back("error", error instanceof HttpError ? (error.detail ?? error.code) : "Не удалось завершить вход.");
    }
  }

  // ---------- Кабинеты ----------

  async function listAccounts(caller: Caller, body: Body) {
    const workspaceId = String(body.workspaceId ?? "");
    await requireManager(caller, workspaceId);
    const { token } = await connectionToken(workspaceId, platform);
    const [available, { data: saved }] = await Promise.all([
      driver.listAccounts(token),
      admin.from("ad_accounts").select("external_id, selected").eq("workspace_id", workspaceId).eq("platform", platform),
    ]);
    const selected = new Set((saved ?? []).filter((a) => a.selected).map((a) => a.external_id));
    return {
      accounts: available.map((a) => ({
        externalId: a.externalId,
        name: a.name,
        currency: a.currency,
        timezone: a.timezone,
        active: a.active,
        // Отчёты считаются в USD и KZT: кабинеты в других валютах пока не подключаются
        supported: SUPPORTED_CURRENCIES.includes(a.currency),
        selected: selected.has(a.externalId),
      })),
    };
  }

  async function selectAccounts(caller: Caller, body: Body) {
    const workspaceId = String(body.workspaceId ?? "");
    await requireManager(caller, workspaceId);
    const wanted = new Set(Array.isArray(body.accounts) ? body.accounts.map(String) : []);
    const { connectionId, token } = await connectionToken(workspaceId, platform);

    // Названия и валюту берём у платформы, а не из запроса браузера
    const available = await driver.listAccounts(token);
    const chosen = available.filter((a) => wanted.has(a.externalId) && SUPPORTED_CURRENCIES.includes(a.currency));

    await admin.from("ad_accounts").update({ selected: false }).eq("workspace_id", workspaceId).eq("platform", platform);
    if (chosen.length) {
      const { error } = await admin.from("ad_accounts").upsert(
        chosen.map((a) => ({
          workspace_id: workspaceId,
          connection_id: connectionId,
          platform,
          external_id: a.externalId,
          name: a.name,
          currency: a.currency,
          timezone: a.timezone || DEFAULT_TIMEZONE,
          external_status: a.externalStatus,
          status: "active",
          selected: true,
        })),
        { onConflict: "workspace_id,platform,external_id" },
      );
      if (error) throw new HttpError(500, "db_error", error.message);
      // С первым настоящим кабинетом демо-данные больше не показываем
      await admin.from("workspaces").update({ demo_data: false }).eq("id", workspaceId);
    }
    const { data: accounts } = await admin.from("ad_accounts").select("id, name").eq("workspace_id", workspaceId).eq("platform", platform).eq("selected", true);
    return { accounts: accounts ?? [] };
  }

  async function disconnect(caller: Caller, body: Body) {
    const workspaceId = String(body.workspaceId ?? "");
    await requireManager(caller, workspaceId);
    const { data: connection } = await admin.from("ad_connections").select("id").eq("workspace_id", workspaceId).eq("platform", platform).maybeSingle();
    if (!connection) throw new HttpError(404, "not_connected");
    // Токен удаляем, загруженная статистика остаётся
    await admin.from("ad_connection_secrets").delete().eq("connection_id", connection.id);
    await admin.from("ad_connections").update({ status: "disconnected", updated_at: new Date().toISOString() }).eq("id", connection.id);
    await admin.from("audit_log").insert({ workspace_id: workspaceId, actor_id: caller.id, action: `${platform}.disconnected`, details: {} });
    return { ok: true };
  }

  // ---------- Синхронизация ----------

  async function loadAccount(workspaceId: string, accountId: string): Promise<Account> {
    const { data } = await admin
      .from("ad_accounts")
      .select("id, workspace_id, external_id, currency")
      .eq("id", accountId)
      .eq("workspace_id", workspaceId)
      .eq("platform", platform)
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
      if (step === "structure") return { rows: await driver.syncStructure(account, token) };
      if (step === "insights") return { rows: await driver.syncInsights(account, token, since, until) };
      if (step === "thumbnails") return await driver.syncThumbnails(account, token);
      throw new HttpError(400, "unknown_step");
    } catch (error) {
      if (error instanceof HttpError && error.code === TOKEN_EXPIRED) await markTokenExpired(workspaceId, platform);
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
    // Курсы валют берутся у Нацбанка: токен платформы для них не нужен
    const token = step === "rates" ? "" : (await connectionToken(workspaceId, platform)).token;
    return runStep(workspaceId, step, body, token);
  }

  /**
   * Плановое обновление всех подключённых кабинетов платформы. Вызывает pg_cron.
   * Необязательный параметр days (до 90) догружает историю глубже обычных трёх дней.
   */
  async function cron(req: Request, body: Body) {
    const { data: secret } = await admin.from("app_secrets").select("value").eq("name", "cron_secret").maybeSingle();
    if (!secret?.value || req.headers.get("x-cron-secret") !== secret.value) throw new HttpError(401, "unauthorized");

    const startedAt = Date.now();
    const days = Math.min(Math.max(Number(body.days) || CRON_LOOKBACK_DAYS + 1, 1), MAX_LOOKBACK_DAYS);
    const windows = insightWindows(days);
    await syncRates(isoDay(days - 1), isoDay());

    const { data: accounts } = await admin
      .from("ad_accounts")
      .select("id, workspace_id, external_id, currency, ad_connections!inner(status)")
      .eq("platform", platform)
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
        if (!tokens.has(account.workspace_id)) tokens.set(account.workspace_id, (await connectionToken(account.workspace_id, platform)).token);
        const token = tokens.get(account.workspace_id)!;
        rows += await driver.syncStructure(account, token);
        for (const window of windows) {
          if (Date.now() - startedAt > CRON_BUDGET_MS) break;
          rows += await driver.syncInsights(account, token, window.since, window.until);
        }
        await driver.syncThumbnails(account, token);
        synced += 1;
      } catch (error) {
        failure = error instanceof HttpError ? (error.detail ?? error.code) : String(error);
        if (error instanceof HttpError && error.code === TOKEN_EXPIRED) await markTokenExpired(account.workspace_id, platform);
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

  const actions: Record<string, (caller: Caller, body: Body) => Promise<unknown>> = {
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
        if (CALLBACK_PARAMS.some((param) => url.searchParams.has(param))) return await callback(url);
        // Проверка настройки: заданы ли ключи приложения платформы. Сами ключи не раскрываются.
        return json({ configured: driver.configured() });
      }
      if (req.method !== "POST") throw new HttpError(405, "method_not_allowed");
      const body = (await req.json().catch(() => ({}))) as Body;
      const name = String(body.action ?? "");
      if (name === "cron") return json(await cron(req, body));
      const action = actions[name];
      if (!action) throw new HttpError(400, "unknown_action");
      return json(await action(await getCaller(req), body));
    } catch (error) {
      if (error instanceof HttpError) {
        // Причину ошибок платформы и базы пишем в журнал функции: по нему видно, что случилось у пользователя
        if (error.status >= 500) console.error(`${platform}-oauth failed:`, error.code, error.detail ?? "");
        return json({ error: error.code, detail: error.detail }, error.status);
      }
      console.error(error);
      return json({ error: "internal" }, 500);
    }
  });
}
