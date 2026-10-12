// Общие части функции `meta-oauth`: окружение, доступы, шифрование токенов и запросы к Graph API.
import { createClient } from "jsr:@supabase/supabase-js@2";

export const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
export const META_APP_ID = Deno.env.get("META_APP_ID") ?? "";
export const META_APP_SECRET = Deno.env.get("META_APP_SECRET") ?? "";
/** Необязательно: ID конфигурации Facebook Login for Business. Без него права передаются через scope. */
export const META_LOGIN_CONFIG_ID = Deno.env.get("META_LOGIN_CONFIG_ID") ?? "";
/** Необязательно: версия Graph API вида "v24.0". Пусто — версия по умолчанию для приложения. */
const GRAPH_VERSION = Deno.env.get("META_GRAPH_VERSION") ?? "";

export const GRAPH_URL = `https://graph.facebook.com${GRAPH_VERSION ? `/${GRAPH_VERSION}` : ""}`;
export const DIALOG_URL = `https://www.facebook.com${GRAPH_VERSION ? `/${GRAPH_VERSION}` : ""}/dialog/oauth`;
export const REDIRECT_URI = `${SUPABASE_URL}/functions/v1/meta-oauth`;
/** Только чтение рекламы. Права на лид-формы и страницы добавятся в Фазе 4. */
export const META_SCOPES = ["ads_read"];
/** Куда можно вернуть браузер после входа через Facebook. */
export const ALLOWED_ORIGINS = ["https://lightleads-indol.vercel.app", "http://localhost:3000"];

const MAX_RETRIES = 3;
const RETRY_BASE_MS = 1500;
/** Коды Graph API «слишком много запросов»: ждём и повторяем. */
const RATE_LIMIT_CODES = new Set([4, 17, 32, 613, 80000, 80004]);
/** Код «токен недействителен»: кабинет нужно переподключить. */
const TOKEN_ERROR_CODE = 190;
const MAX_PAGES = 40;

export const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

export const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

export class HttpError extends Error {
  constructor(public status: number, public code: string, public detail?: string) {
    super(code);
  }
}

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

// ---------- Доступы ----------

export interface Caller {
  id: string;
  isPlatformAdmin: boolean;
}

export async function getCaller(req: Request): Promise<Caller> {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) throw new HttpError(401, "unauthorized");
  const { data: profile } = await admin.from("profiles").select("is_platform_admin").eq("id", data.user.id).maybeSingle();
  return { id: data.user.id, isPlatformAdmin: profile?.is_platform_admin === true };
}

async function memberRole(workspaceId: string, userId: string): Promise<string | null> {
  const { data } = await admin.from("workspace_members").select("role").eq("workspace_id", workspaceId).eq("user_id", userId).maybeSingle();
  return data?.role ?? null;
}

/** Участник workspace (читать и обновлять данные может любой участник). */
export async function requireMember(caller: Caller, workspaceId: string) {
  if (!workspaceId) throw new HttpError(400, "workspace_required");
  if (!(await memberRole(workspaceId, caller.id))) throw new HttpError(403, "forbidden");
}

/** Подключать и отключать кабинеты может владелец workspace или владелец платформы. */
export async function requireManager(caller: Caller, workspaceId: string) {
  if (!workspaceId) throw new HttpError(400, "workspace_required");
  if (caller.isPlatformAdmin) return;
  if ((await memberRole(workspaceId, caller.id)) !== "owner") throw new HttpError(403, "forbidden");
}

// ---------- Шифрование и подпись ----------

const encoder = new TextEncoder();
const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64 = (text: string) => Uint8Array.from(atob(text.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

/**
 * Ключи выводятся из секрета, которого нет в базе: TOKEN_ENCRYPTION_KEY, а если он не задан —
 * из сервисного ключа проекта. Утечка одной базы токены не раскрывает.
 */
async function deriveKey(purpose: string, algorithm: AesKeyGenParams | HmacImportParams, usages: KeyUsage[]) {
  const secret = Deno.env.get("TOKEN_ENCRYPTION_KEY") || SERVICE_KEY;
  const material = await crypto.subtle.importKey("raw", encoder.encode(secret), "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: encoder.encode("lightleads"), info: encoder.encode(purpose) },
    material,
    algorithm,
    false,
    usages,
  );
}

const tokenKey = () => deriveKey("ad-token", { name: "AES-GCM", length: 256 }, ["encrypt", "decrypt"]);
const stateKey = () => deriveKey("oauth-state", { name: "HMAC", hash: "SHA-256", length: 256 }, ["sign", "verify"]);

/** AES-256-GCM. Формат: base64url(iv).base64url(шифртекст). */
export async function encryptToken(token: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await tokenKey(), encoder.encode(token));
  return `${b64(iv)}.${b64(new Uint8Array(cipher))}`;
}

export async function decryptToken(value: string): Promise<string> {
  const [iv, cipher] = value.split(".");
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(iv) }, await tokenKey(), unb64(cipher));
  return new TextDecoder().decode(plain);
}

/** Подписанный параметр state: по нему callback узнаёт, чей это вход, и отсекает подделку. */
export async function signState(payload: Record<string, unknown>): Promise<string> {
  const body = b64(encoder.encode(JSON.stringify(payload)));
  const signature = await crypto.subtle.sign("HMAC", await stateKey(), encoder.encode(body));
  return `${body}.${b64(new Uint8Array(signature))}`;
}

export async function verifyState<T>(state: string): Promise<T | null> {
  const [body, signature] = state.split(".");
  if (!body || !signature) return null;
  const valid = await crypto.subtle.verify("HMAC", await stateKey(), unb64(signature), encoder.encode(body));
  if (!valid) return null;
  const payload = JSON.parse(new TextDecoder().decode(unb64(body))) as T & { exp?: number };
  return payload.exp && payload.exp > Date.now() ? payload : null;
}

// ---------- Graph API ----------

interface GraphError {
  message?: string;
  code?: number;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** GET к Graph API с повторами при лимитах и временных сбоях. */
export async function graphGet<T>(pathOrUrl: string, params: Record<string, string> = {}, token?: string): Promise<T> {
  const url = new URL(pathOrUrl.startsWith("http") ? pathOrUrl : `${GRAPH_URL}${pathOrUrl}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  if (token) url.searchParams.set("access_token", token);

  for (let attempt = 0; ; attempt++) {
    const response = await fetch(url);
    const payload = (await response.json().catch(() => ({}))) as { error?: GraphError };
    if (response.ok && !payload.error) return payload as T;

    const error = payload.error ?? {};
    if (error.code === TOKEN_ERROR_CODE) throw new HttpError(401, "meta_token_expired", error.message);
    const retryable = response.status >= 500 || RATE_LIMIT_CODES.has(error.code ?? -1);
    if (!retryable || attempt >= MAX_RETRIES) throw new HttpError(502, "meta_error", error.message ?? `HTTP ${response.status}`);
    await sleep(RETRY_BASE_MS * 2 ** attempt);
  }
}

/** Собирает все страницы списка (paging.next). */
export async function graphList<T>(path: string, params: Record<string, string>, token: string): Promise<T[]> {
  const rows: T[] = [];
  let page = await graphGet<{ data?: T[]; paging?: { next?: string } }>(path, params, token);
  for (let i = 0; i < MAX_PAGES; i++) {
    rows.push(...(page.data ?? []));
    if (!page.paging?.next) break;
    page = await graphGet(page.paging.next);
  }
  return rows;
}

/** Расшифрованный токен подключения Meta для workspace. */
export async function connectionToken(workspaceId: string): Promise<{ connectionId: string; token: string }> {
  const { data: connection } = await admin
    .from("ad_connections")
    .select("id, status")
    .eq("workspace_id", workspaceId)
    .eq("platform", "meta")
    .maybeSingle();
  if (!connection || connection.status === "disconnected") throw new HttpError(404, "not_connected");
  const { data: secret } = await admin.from("ad_connection_secrets").select("token_encrypted").eq("connection_id", connection.id).maybeSingle();
  if (!secret) throw new HttpError(404, "not_connected");
  return { connectionId: connection.id, token: await decryptToken(secret.token_encrypted) };
}

/** Помечает подключение как требующее повторного входа. */
export async function markTokenExpired(workspaceId: string) {
  await admin.from("ad_connections").update({ status: "token_expired", updated_at: new Date().toISOString() }).eq("workspace_id", workspaceId).eq("platform", "meta");
  await admin.from("ad_accounts").update({ status: "token_expired" }).eq("workspace_id", workspaceId).eq("platform", "meta");
}
