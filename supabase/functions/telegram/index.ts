// Edge Function `telegram`: бот LightLeads присылает новые заявки проекта в Telegram.
//   POST + X-Telegram-Bot-Api-Secret-Token — обновление от Telegram: «/start КОД» подключает чат к проекту
//   POST {action:"cron"} + x-cron-secret   — раз в минуту, когда есть очередь: отправить новые заявки
//   POST {action} + JWT                    — участник проекта: ссылка на бота, список чатов, проверка, отключение
//   GET                                    — настроен ли бот (без раскрытия токена)
// Токен бота (TELEGRAM_BOT_TOKEN) владелец платформы задаёт в секретах Edge Functions.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { admin, ALLOWED_ORIGINS, type Caller, CORS, getCaller, HttpError, json, requireMember, SUPABASE_URL } from "../_shared/core.ts";
import { type LeadNotice, leadMessage, type OutgoingMessage, parseStart, sameText, summaryMessage, testMessage, webhookSecret } from "./message.ts";

const BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
const API_URL = `https://api.telegram.org/bot${BOT_TOKEN}`;
const WEBHOOK_URL = `${SUPABASE_URL}/functions/v1/telegram`;
const APP_URL = ALLOWED_ORIGINS[0];
const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;
const CODE_TTL_MS = 30 * MINUTE_MS;
const CODE_BYTES = 12;
const MAX_CHATS = 10;
/** Столько заявок из очереди разбираем за один запуск. */
const MAX_QUEUE = 500;
/** Больше стольких заявок проекта сразу — одно сообщение-сводка, иначе Telegram ограничит отправку. */
const SUMMARY_AFTER = 5;
const MAX_ERROR_LENGTH = 300;
const MAX_TITLE_LENGTH = 120;
/** Заявки, которые не удалось отправить за сутки, уже не новость. */
const STALE_MS = DAY_MS;
const UPDATES = ["message", "my_chat_member"];

type Body = Record<string, unknown>;

interface ChatRow {
  id: string;
  workspace_id: string;
  chat_id: number;
  title: string;
  kind: "private" | "group";
  status: "active" | "error";
  error: string | null;
  last_sent_at: string | null;
  created_by: string | null;
  created_at: string;
}
const CHAT_COLUMNS = "id, workspace_id, chat_id, title, kind, status, error, last_sent_at, created_by, created_at";

// ---------- Bot API ----------

class TelegramError extends Error {
  constructor(public code: number, public description: string, public migrateTo?: number) {
    super(description);
  }
  /** Чат недоступен навсегда: бота удалили, заблокировали или чата нет. */
  get permanent() {
    return this.code === 403 || (this.code === 400 && /chat not found|bot was kicked|not a member|blocked/i.test(this.description));
  }
}

async function tg<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_URL}/${method}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(params) });
  } catch (error) {
    throw new TelegramError(0, String(error));
  }
  const payload = (await response.json().catch(() => ({}))) as { ok?: boolean; result?: T; description?: string; error_code?: number; parameters?: { migrate_to_chat_id?: number } };
  if (!payload.ok) throw new TelegramError(payload.error_code ?? response.status, payload.description ?? `HTTP ${response.status}`, payload.parameters?.migrate_to_chat_id);
  return payload.result as T;
}

let botName: string | null = null;
async function botUsername(): Promise<string> {
  botName ??= (await tg<{ username: string }>("getMe")).username;
  return botName;
}

/** Адрес вебхука ставим при каждом подключении: так он всегда совпадает с текущим токеном бота. */
async function ensureWebhook() {
  await tg("setWebhook", { url: WEBHOOK_URL, secret_token: await webhookSecret(BOT_TOKEN), allowed_updates: UPDATES });
}

const send = (chatId: number, message: OutgoingMessage) =>
  tg("sendMessage", {
    chat_id: chatId,
    text: message.text,
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
    ...(message.buttons.length ? { reply_markup: { inline_keyboard: message.buttons.map((button) => [button]) } } : {}),
  });

const reply = (chatId: number, text: string) => send(chatId, { text, buttons: [] }).catch((error) => console.error("telegram reply failed:", String(error)));

function requireBot() {
  if (!BOT_TOKEN) throw new HttpError(503, "not_configured");
}

// ---------- Обновления от Telegram ----------

interface TgChat {
  id: number;
  type: string;
  title?: string;
  first_name?: string;
  last_name?: string;
  username?: string;
}

const chatTitle = (chat: TgChat) =>
  (chat.title || [chat.first_name, chat.last_name].filter(Boolean).join(" ") || chat.username || "").trim().slice(0, MAX_TITLE_LENGTH) || String(chat.id);

async function workspaceName(workspaceId: string): Promise<string> {
  const { data } = await admin.from("workspaces").select("name").eq("id", workspaceId).maybeSingle();
  return data?.name ?? "";
}

/** «/start КОД» из ссылки в LightLeads: подключаем этот чат к проекту. */
async function linkChat(chat: TgChat, code: string) {
  if (chat.type === "channel") return;
  if (!code) {
    await reply(chat.id, "Это бот LightLeads. Чтобы получать сюда заявки, откройте LightLeads → Настройки → Telegram и нажмите «Подключить».");
    return;
  }
  const { data: link } = await admin.from("telegram_link_codes").select("workspace_id, created_by, expires_at").eq("code", code).maybeSingle();
  if (!link || Date.parse(link.expires_at) < Date.now()) {
    await reply(chat.id, "Ссылка устарела. Откройте LightLeads → Настройки → Telegram и нажмите «Подключить» ещё раз.");
    return;
  }
  const { error } = await admin.from("telegram_chats").upsert(
    { workspace_id: link.workspace_id, chat_id: chat.id, title: chatTitle(chat), kind: chat.type === "private" ? "private" : "group", status: "active", error: null, created_by: link.created_by },
    { onConflict: "workspace_id,chat_id" },
  );
  if (error) throw new HttpError(500, "db_error", error.message);
  await admin.from("telegram_link_codes").delete().eq("code", code);
  await admin.from("audit_log").insert({ workspace_id: link.workspace_id, actor_id: link.created_by, action: "telegram.linked", details: { kind: chat.type } });
  await reply(chat.id, `✅ Готово! Сюда будут приходить новые заявки проекта «${(await workspaceName(link.workspace_id)).replace(/[<>&]/g, "")}».`);
}

async function update(req: Request): Promise<Response> {
  if (!BOT_TOKEN || !sameText(req.headers.get("x-telegram-bot-api-secret-token") ?? "", await webhookSecret(BOT_TOKEN))) throw new HttpError(401, "unauthorized");
  const body = (await req.json().catch(() => ({}))) as {
    message?: { chat?: TgChat; text?: string; migrate_to_chat_id?: number };
    my_chat_member?: { chat?: TgChat; new_chat_member?: { status?: string } };
  };
  const message = body.message;
  if (message?.chat) {
    // Группа стала супергруппой: у неё новый ID
    if (message.migrate_to_chat_id) await admin.from("telegram_chats").update({ chat_id: message.migrate_to_chat_id }).eq("chat_id", message.chat.id);
    const code = typeof message.text === "string" ? parseStart(message.text) : null;
    if (code !== null) await linkChat(message.chat, code);
  }
  // Бота удалили из группы или заблокировали в личке: заявки туда больше не шлём
  const member = body.my_chat_member;
  if (member?.chat && ["left", "kicked"].includes(member.new_chat_member?.status ?? "")) {
    await admin.from("telegram_chats").delete().eq("chat_id", member.chat.id);
  }
  return json({ ok: true });
}

// ---------- Отправка заявок ----------

interface QueueRow {
  lead_id: string;
  workspace_id: string;
  queued_at: string;
}

interface LeadRow {
  id: string;
  name: string;
  phone: string;
  source: string;
  created_at: string;
  raw_payload: { message?: unknown } | null;
  ads: { name: string } | null;
  campaigns: { name: string } | null;
}

const errorText = (error: unknown) => String(error instanceof TelegramError ? error.description : error).slice(0, MAX_ERROR_LENGTH);

/** Отправка в чат с одной повторной попыткой, если группа сменила ID. */
async function deliver(chat: ChatRow, message: OutgoingMessage) {
  try {
    await send(chat.chat_id, message);
  } catch (error) {
    if (!(error instanceof TelegramError) || !error.migrateTo) throw error;
    await admin.from("telegram_chats").update({ chat_id: error.migrateTo }).eq("chat_id", chat.chat_id);
    chat.chat_id = error.migrateTo;
    await send(chat.chat_id, message);
  }
}

/**
 * Отправляет сообщения во все чаты проекта. false — временный сбой (лимит Telegram, сеть):
 * заявки остаются в очереди до следующего запуска. Чат, который недоступен навсегда, помечается ошибкой.
 */
async function broadcast(chats: ChatRow[], message: OutgoingMessage): Promise<boolean> {
  for (const chat of chats.filter((item) => item.status === "active")) {
    try {
      await deliver(chat, message);
      await admin.from("telegram_chats").update({ last_sent_at: new Date().toISOString(), error: null }).eq("id", chat.id);
    } catch (error) {
      if (error instanceof TelegramError && error.permanent) {
        chat.status = "error";
        await admin
          .from("telegram_chats")
          .update({ status: "error", error: "Бот не может писать в этот чат: его удалили или заблокировали. Подключите чат заново." })
          .eq("id", chat.id);
        continue;
      }
      console.error("telegram send failed:", errorText(error));
      return false;
    }
  }
  return true;
}

function notice(project: string, row: LeadRow): LeadNotice {
  const message = row.raw_payload?.message;
  return {
    project,
    name: row.name,
    phone: row.phone,
    source: row.source,
    createdAt: row.created_at,
    adName: row.ads?.name ?? null,
    campaignName: row.campaigns?.name ?? null,
    message: typeof message === "string" && message.trim() ? message.trim() : null,
  };
}

async function sendWorkspace(workspaceId: string, items: QueueRow[]): Promise<number> {
  const done = async (ids: string[]) => {
    if (ids.length) await admin.from("telegram_queue").delete().in("lead_id", ids);
  };
  const { data: chats } = await admin.from("telegram_chats").select(CHAT_COLUMNS).eq("workspace_id", workspaceId).eq("status", "active");
  if (!chats?.length) {
    await done(items.map((item) => item.lead_id));
    return 0;
  }
  const { data: rows } = await admin
    .from("leads")
    .select("id, name, phone, source, created_at, raw_payload, ads(name), campaigns(name)")
    .in("id", items.map((item) => item.lead_id))
    .order("created_at");
  const project = await workspaceName(workspaceId);
  const leads = ((rows ?? []) as unknown as LeadRow[]).map((row) => ({ id: row.id, notice: notice(project, row) }));
  const all = items.map((item) => item.lead_id);

  if (leads.length > SUMMARY_AFTER) {
    if (await broadcast(chats as ChatRow[], summaryMessage(project, leads.map((lead) => lead.notice), APP_URL))) await done(all);
    return leads.length;
  }
  let sent = 0;
  const finished = all.filter((id) => !leads.some((lead) => lead.id === id));
  for (const lead of leads) {
    if (!(await broadcast(chats as ChatRow[], leadMessage(lead.notice, APP_URL)))) break;
    finished.push(lead.id);
    sent += 1;
  }
  await done(finished);
  return sent;
}

async function cron(req: Request) {
  const { data: secret } = await admin.from("app_secrets").select("value").eq("name", "cron_secret").maybeSingle();
  if (!secret?.value || req.headers.get("x-cron-secret") !== secret.value) throw new HttpError(401, "unauthorized");

  const staleBefore = new Date(Date.now() - STALE_MS).toISOString();
  await admin.from("telegram_queue").delete().lt("queued_at", staleBefore);
  if (!BOT_TOKEN) return { sent: 0, configured: false };

  const { data: queue } = await admin.from("telegram_queue").select("lead_id, workspace_id, queued_at").order("queued_at").limit(MAX_QUEUE);
  const byWorkspace = new Map<string, QueueRow[]>();
  for (const item of (queue ?? []) as QueueRow[]) byWorkspace.set(item.workspace_id, [...(byWorkspace.get(item.workspace_id) ?? []), item]);
  let sent = 0;
  for (const [workspaceId, items] of byWorkspace) sent += await sendWorkspace(workspaceId, items);
  return { sent, workspaces: byWorkspace.size };
}

// ---------- Действия участника ----------

const workspaceOf = (body: Body) => String(body.workspaceId ?? "");

async function listChats(workspaceId: string) {
  const { data } = await admin.from("telegram_chats").select(CHAT_COLUMNS).eq("workspace_id", workspaceId).order("created_at");
  return ((data ?? []) as ChatRow[]).map((chat) => ({
    id: chat.id,
    title: chat.title,
    kind: chat.kind,
    status: chat.status,
    error: chat.error,
    lastSentAt: chat.last_sent_at,
    createdAt: chat.created_at,
  }));
}

async function status(caller: Caller, body: Body) {
  const workspaceId = workspaceOf(body);
  await requireMember(caller, workspaceId);
  const bot = BOT_TOKEN ? await botUsername().catch(() => null) : null;
  return { configured: Boolean(BOT_TOKEN), bot, chats: await listChats(workspaceId) };
}

/** Ссылки на бота с одноразовым кодом: в личный чат или в группу. */
async function link(caller: Caller, body: Body) {
  const workspaceId = workspaceOf(body);
  await requireMember(caller, workspaceId);
  requireBot();
  const { count } = await admin.from("telegram_chats").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId);
  if ((count ?? 0) >= MAX_CHATS) throw new HttpError(409, "chat_limit");

  await ensureWebhook();
  const bot = await botUsername();
  await admin.from("telegram_link_codes").delete().lt("expires_at", new Date().toISOString());
  const code = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(CODE_BYTES)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const { error } = await admin.from("telegram_link_codes").insert({ code, workspace_id: workspaceId, created_by: caller.id, expires_at: new Date(Date.now() + CODE_TTL_MS).toISOString() });
  if (error) throw new HttpError(500, "db_error", error.message);
  return { bot, privateUrl: `https://t.me/${bot}?start=${code}`, groupUrl: `https://t.me/${bot}?startgroup=${code}` };
}

async function chatOf(caller: Caller, body: Body): Promise<ChatRow> {
  const workspaceId = workspaceOf(body);
  await requireMember(caller, workspaceId);
  const { data } = await admin.from("telegram_chats").select(CHAT_COLUMNS).eq("id", String(body.chatId ?? "")).eq("workspace_id", workspaceId).maybeSingle();
  if (!data) throw new HttpError(404, "chat_not_found");
  return data as ChatRow;
}

async function test(caller: Caller, body: Body) {
  requireBot();
  const chat = await chatOf(caller, body);
  const ok = await broadcast([{ ...chat, status: "active" }], testMessage(await workspaceName(chat.workspace_id), APP_URL));
  const { data } = await admin.from("telegram_chats").select("status").eq("id", chat.id).maybeSingle();
  if (!ok || data?.status === "error") throw new HttpError(502, "send_failed");
  // Проверка прошла: чат снова в работе
  await admin.from("telegram_chats").update({ status: "active", error: null }).eq("id", chat.id);
  return { ok: true };
}

/** Отключить чат может тот, кто его подключил, владелец проекта или владелец платформы. */
async function unlink(caller: Caller, body: Body) {
  const chat = await chatOf(caller, body);
  if (chat.created_by !== caller.id && !caller.isPlatformAdmin) {
    const { data } = await admin.from("workspace_members").select("role").eq("workspace_id", chat.workspace_id).eq("user_id", caller.id).maybeSingle();
    if (data?.role !== "owner") throw new HttpError(403, "forbidden");
  }
  await admin.from("telegram_chats").delete().eq("id", chat.id);
  await admin.from("audit_log").insert({ workspace_id: chat.workspace_id, actor_id: caller.id, action: "telegram.unlinked", details: { kind: chat.kind } });
  if (BOT_TOKEN) await reply(chat.chat_id, `Заявки проекта «${(await workspaceName(chat.workspace_id)).replace(/[<>&]/g, "")}» больше не приходят в этот чат.`);
  return { ok: true };
}

/** Владельцу платформы: настроен ли бот и доходят ли до нас обновления Telegram. */
async function botInfo(caller: Caller) {
  if (!caller.isPlatformAdmin) throw new HttpError(403, "forbidden");
  if (!BOT_TOKEN) return { configured: false, bot: null, lastError: null };
  try {
    await ensureWebhook();
    const info = await tg<{ last_error_message?: string; last_error_date?: number }>("getWebhookInfo");
    return { configured: true, bot: await botUsername(), lastError: info.last_error_message ?? null };
  } catch (error) {
    // Чаще всего — неверный токен: показываем владельцу, что ответил Telegram
    return { configured: true, bot: null, lastError: errorText(error) };
  }
}

const ACTIONS: Record<string, (caller: Caller, body: Body) => Promise<unknown>> = { status, link, test, unlink, bot_info: botInfo };

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    if (req.method === "GET") return json({ configured: Boolean(BOT_TOKEN) });
    if (req.method !== "POST") throw new HttpError(405, "method_not_allowed");
    if (req.headers.has("x-telegram-bot-api-secret-token")) return await update(req);

    const body = (await req.json().catch(() => ({}))) as Body;
    const name = String(body.action ?? "");
    if (name === "cron") return json(await cron(req));
    const action = ACTIONS[name];
    if (!action) throw new HttpError(400, "unknown_action");
    return json(await action(await getCaller(req), body));
  } catch (error) {
    if (error instanceof HttpError) {
      if (error.status >= 500) console.error("telegram failed:", error.code, error.detail ?? "");
      return json({ error: error.code, detail: error.detail }, error.status);
    }
    console.error(error);
    return json({ error: "internal" }, 500);
  }
});
