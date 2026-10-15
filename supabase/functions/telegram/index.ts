// Edge Function `telegram`: бот LightLeads присылает новые заявки проекта в Telegram
// и передаёт клиентам WhatsApp ответы менеджеров.
//   POST + X-Telegram-Bot-Api-Secret-Token — обновление от Telegram: «/start КОД» подключает чат к проекту,
//                                           ответ на сообщение клиента WhatsApp уходит этому клиенту
//   POST {action:"cron"} + x-cron-secret   — раз в минуту, когда есть очередь: отправить новые заявки
//   POST {action} + JWT                    — участник проекта: ссылка на бота, список чатов, проверка, отключение
//   GET                                    — настроен ли бот (без раскрытия токена)
// Токен бота (TELEGRAM_BOT_TOKEN) владелец платформы задаёт в секретах Edge Functions.
// Сообщения клиентов WhatsApp в Telegram присылает функция `meta-leads`.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { admin, type Caller, connectionToken, CORS, getCaller, HttpError, json, requireMember, SUPABASE_URL } from "../_shared/core.ts";
import { GRAPH_URL } from "../meta-oauth/lib.ts";
import { APP_URL, BOT_TOKEN, broadcast, CHAT_COLUMNS, type ChatRow, errorText, leadNotices, reply, tg, workspaceName } from "./bot.ts";
import { leadMessage, parseStart, sameText, summaryMessage, testMessage, webhookSecret } from "./message.ts";
import { whatsappProblem } from "./whatsapp.ts";

const WEBHOOK_URL = `${SUPABASE_URL}/functions/v1/telegram`;
const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;
const CODE_TTL_MS = 30 * MINUTE_MS;
const CODE_BYTES = 12;
const MAX_CHATS = 10;
/** Столько заявок из очереди разбираем за один запуск. */
const MAX_QUEUE = 500;
/** Больше стольких заявок проекта сразу — одно сообщение-сводка, иначе Telegram ограничит отправку. */
const SUMMARY_AFTER = 5;
const MAX_TITLE_LENGTH = 120;
/** Предел длины текстового сообщения WhatsApp. */
const MAX_WHATSAPP_TEXT = 4096;
/** Заявки, которые не удалось отправить за сутки, уже не новость. */
const STALE_MS = DAY_MS;
const UPDATES = ["message", "my_chat_member"];
const SENT_REACTION = "👍";

type Body = Record<string, unknown>;

let botName: string | null = null;
async function botUsername(): Promise<string> {
  botName ??= (await tg<{ username: string }>("getMe")).username;
  return botName;
}

/** Адрес вебхука ставим при каждом подключении: так он всегда совпадает с текущим токеном бота. */
async function ensureWebhook() {
  await tg("setWebhook", { url: WEBHOOK_URL, secret_token: await webhookSecret(BOT_TOKEN), allowed_updates: UPDATES });
}

function requireBot() {
  if (!BOT_TOKEN) throw new HttpError(503, "not_configured");
}

const plain = (text: string) => text.replace(/[<>&]/g, "");

// ---------- Обновления от Telegram ----------

interface TgChat {
  id: number;
  type: string;
  title?: string;
  first_name?: string;
  last_name?: string;
  username?: string;
}

interface TgMessage {
  message_id: number;
  chat?: TgChat;
  from?: { is_bot?: boolean };
  text?: string;
  migrate_to_chat_id?: number;
  reply_to_message?: { message_id: number };
}

const chatTitle = (chat: TgChat) =>
  (chat.title || [chat.first_name, chat.last_name].filter(Boolean).join(" ") || chat.username || "").trim().slice(0, MAX_TITLE_LENGTH) || String(chat.id);

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
  await reply(chat.id, `✅ Готово! Сюда будут приходить новые заявки проекта «${plain(await workspaceName(link.workspace_id))}».`);
}

interface Thread {
  workspace_id: string;
  channel_id: string;
  wa_id: string;
}

/** Отправляет текст клиенту с номера компании. Возвращает null или понятное объяснение, почему не вышло. */
async function sendWhatsApp(thread: Thread, text: string): Promise<string | null> {
  const { data: channel } = await admin.from("lead_channels").select("external_id").eq("id", thread.channel_id).maybeSingle();
  if (!channel) return "Этот номер WhatsApp уже отключён от проекта в LightLeads.";
  let token: string;
  try {
    token = (await connectionToken(thread.workspace_id, "meta")).token;
  } catch {
    return "В проекте не подключена Meta: откройте LightLeads → Настройки → Подключения.";
  }
  const response = await fetch(`${GRAPH_URL}/${channel.external_id}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to: thread.wa_id, type: "text", text: { body: text.slice(0, MAX_WHATSAPP_TEXT), preview_url: false } }),
  }).catch(() => null);
  if (!response) return "Не удалось связаться с WhatsApp. Попробуйте ещё раз через минуту.";
  const payload = (await response.json().catch(() => ({}))) as { error?: { code?: number; message?: string } };
  if (response.ok && !payload.error) return null;
  return whatsappProblem(payload.error?.code ?? response.status, payload.error?.message ?? `HTTP ${response.status}`);
}

/** Менеджер ответил на сообщение клиента WhatsApp: пересылаем ответ клиенту. */
async function relayReply(message: TgMessage, chat: TgChat, repliedTo: number) {
  const { data: thread } = await admin.from("telegram_threads").select("workspace_id, channel_id, wa_id").eq("chat_id", chat.id).eq("message_id", repliedTo).maybeSingle();
  // Ответ на другое сообщение бота («Готово», сводка заявок) — не переписка с клиентом
  if (!thread) return;
  const text = message.text?.trim();
  if (!text) {
    await reply(chat.id, "Клиенту в WhatsApp пока можно отправить только текст.", message.message_id);
    return;
  }
  const problem = await sendWhatsApp(thread, text);
  if (problem) {
    await reply(chat.id, `⚠️ Не отправлено. ${problem}`, message.message_id);
    return;
  }
  await admin.from("audit_log").insert({ workspace_id: thread.workspace_id, actor_id: null, action: "whatsapp.reply_sent", details: { via: "telegram" } });
  await tg("setMessageReaction", { chat_id: chat.id, message_id: message.message_id, reaction: [{ type: "emoji", emoji: SENT_REACTION }] }).catch(() =>
    reply(chat.id, "✅ Отправлено клиенту.", message.message_id),
  );
}

async function update(req: Request): Promise<Response> {
  if (!BOT_TOKEN || !sameText(req.headers.get("x-telegram-bot-api-secret-token") ?? "", await webhookSecret(BOT_TOKEN))) throw new HttpError(401, "unauthorized");
  const body = (await req.json().catch(() => ({}))) as {
    message?: TgMessage;
    my_chat_member?: { chat?: TgChat; new_chat_member?: { status?: string } };
  };
  const message = body.message;
  const chat = message?.chat;
  if (message && chat) {
    // Группа стала супергруппой: у неё новый ID
    if (message.migrate_to_chat_id) await admin.from("telegram_chats").update({ chat_id: message.migrate_to_chat_id }).eq("chat_id", chat.id);
    const code = typeof message.text === "string" ? parseStart(message.text) : null;
    if (code !== null) await linkChat(chat, code);
    else if (message.reply_to_message && !message.from?.is_bot) await relayReply(message, chat, message.reply_to_message.message_id);
  }
  // Бота удалили из группы или заблокировали в личке: заявки туда больше не шлём
  const member = body.my_chat_member;
  if (member?.chat && ["left", "kicked"].includes(member.new_chat_member?.status ?? "")) {
    await admin.from("telegram_chats").delete().eq("chat_id", member.chat.id);
  }
  return json({ ok: true });
}

// ---------- Отправка заявок из очереди ----------

interface QueueRow {
  lead_id: string;
  workspace_id: string;
  queued_at: string;
}

async function sendWorkspace(workspaceId: string, items: QueueRow[]): Promise<number> {
  const done = async (ids: string[]) => {
    if (ids.length) await admin.from("telegram_queue").delete().in("lead_id", ids);
  };
  const all = items.map((item) => item.lead_id);
  const { data } = await admin.from("telegram_chats").select(CHAT_COLUMNS).eq("workspace_id", workspaceId).eq("status", "active");
  const chats = (data ?? []) as ChatRow[];
  if (!chats.length) {
    await done(all);
    return 0;
  }
  const leads = await leadNotices(all);

  if (leads.length > SUMMARY_AFTER) {
    const project = leads[0].notice.project;
    if ((await broadcast(chats, summaryMessage(project, leads.map((lead) => lead.notice), APP_URL))).ok) await done(all);
    return leads.length;
  }
  let sent = 0;
  const finished = all.filter((id) => !leads.some((lead) => lead.id === id));
  for (const lead of leads) {
    if (!(await broadcast(chats, leadMessage(lead.notice, APP_URL))).ok) break;
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
  const { ok } = await broadcast([{ ...chat, status: "active" }], testMessage(await workspaceName(chat.workspace_id), APP_URL));
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
  if (BOT_TOKEN) await reply(chat.chat_id, `Заявки проекта «${plain(await workspaceName(chat.workspace_id))}» больше не приходят в этот чат.`);
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
