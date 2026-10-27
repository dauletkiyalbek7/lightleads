// Бот LightLeads: запросы к Telegram Bot API и отправка в чаты проекта.
// Общий для функций `telegram` (заявки из очереди, ответы менеджеров) и `meta-leads` (переписка WhatsApp).
import { admin, ALLOWED_ORIGINS } from "../_shared/core.ts";
import type { LeadNotice, MediaKind, OutgoingMessage } from "./message.ts";

export const BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
const API_URL = `https://api.telegram.org/bot${BOT_TOKEN}`;
const FILE_URL = `https://api.telegram.org/file/bot${BOT_TOKEN}`;
const HTTP_BAD_REQUEST = 400;
const MEDIA_METHODS: Record<MediaKind, string> = { photo: "sendPhoto", video: "sendVideo", voice: "sendVoice", audio: "sendAudio", document: "sendDocument" };
export const APP_URL = ALLOWED_ORIGINS[0];
const MAX_ERROR_LENGTH = 300;
const BROKEN_CHAT_NOTE = "Бот не может писать в этот чат: его удалили или заблокировали. Подключите чат заново.";

export interface ChatRow {
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
export const CHAT_COLUMNS = "id, workspace_id, chat_id, title, kind, status, error, last_sent_at, created_by, created_at";

export class TelegramError extends Error {
  constructor(public code: number, public description: string, public migrateTo?: number) {
    super(description);
  }
  /** Чат недоступен навсегда: бота удалили, заблокировали или чата нет. */
  get permanent() {
    return this.code === 403 || (this.code === 400 && /chat not found|bot was kicked|not a member|blocked/i.test(this.description));
  }
}

export const errorText = (error: unknown) => String(error instanceof TelegramError ? error.description : error).slice(0, MAX_ERROR_LENGTH);

/** Запрос с файлом: multipart, остальные поля — строками, объекты — в JSON. */
function formOf(params: Record<string, unknown>): FormData {
  const form = new FormData();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    if (value instanceof Blob) form.append(key, value);
    else form.append(key, typeof value === "object" ? JSON.stringify(value) : String(value));
  }
  return form;
}

export async function tg<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
  const withFile = Object.values(params).some((value) => value instanceof Blob);
  let response: Response;
  try {
    response = await fetch(
      `${API_URL}/${method}`,
      withFile ? { method: "POST", body: formOf(params) } : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(params) },
    );
  } catch (error) {
    throw new TelegramError(0, String(error));
  }
  const payload = (await response.json().catch(() => ({}))) as { ok?: boolean; result?: T; description?: string; error_code?: number; parameters?: { migrate_to_chat_id?: number } };
  if (!payload.ok) throw new TelegramError(payload.error_code ?? response.status, payload.description ?? `HTTP ${response.status}`, payload.parameters?.migrate_to_chat_id);
  return payload.result as T;
}

interface SentFile {
  file_id: string;
}
interface SentMessage {
  message_id: number;
  photo?: SentFile[];
  video?: SentFile;
  voice?: SentFile;
  audio?: SentFile;
  document?: SentFile;
}

/** ID файла в отправленном сообщении: Telegram мог показать его не тем видом, каким отправляли. */
const sentFileId = (sent: SentMessage) => sent.photo?.at(-1)?.file_id ?? (sent.video ?? sent.voice ?? sent.audio ?? sent.document)?.file_id ?? null;

/** Отправляет сообщение; replyTo — ответом на сообщение в чате. Возвращает ID отправленного сообщения. */
export async function send(chatId: number, message: OutgoingMessage, replyTo?: number): Promise<number> {
  const params = {
    chat_id: chatId,
    parse_mode: "HTML",
    ...(replyTo ? { reply_parameters: { message_id: replyTo, allow_sending_without_reply: true } } : {}),
    ...(message.forceReply
      ? { reply_markup: { force_reply: true, selective: true, input_field_placeholder: message.forceReply } }
      : message.buttons.length
        ? { reply_markup: { inline_keyboard: message.buttons.map((button) => [button]) } }
        : {}),
  };
  const attachment = message.attachment;
  if (!attachment) return (await tg<SentMessage>("sendMessage", { ...params, text: message.text, link_preview_options: { is_disabled: true } })).message_id;

  const sendAs = (kind: MediaKind) => tg<SentMessage>(MEDIA_METHODS[kind], { ...params, caption: message.text, [kind]: attachment.file });
  let kind = attachment.kind;
  let sent: SentMessage;
  try {
    sent = await sendAs(kind);
  } catch (error) {
    // Telegram не принял файл как фото, видео или голосовое (размер, формат): отправляем документом
    if (!(error instanceof TelegramError) || error.code !== HTTP_BAD_REQUEST || error.permanent || error.migrateTo || kind === "document") throw error;
    kind = "document";
    sent = await sendAs(kind);
  }
  // Файл уже в Telegram: в остальные чаты проекта он уйдёт по ID, без повторной загрузки
  const fileId = sentFileId(sent);
  if (fileId) Object.assign(attachment, { kind, file: fileId });
  return sent.message_id;
}

/** Скачивает файл, который прислали боту: Telegram отдаёт ботам файлы до 20 МБ. */
export async function downloadFile(fileId: string): Promise<Blob> {
  const file = await tg<{ file_path?: string }>("getFile", { file_id: fileId });
  if (!file.file_path) throw new TelegramError(0, "file_path missing");
  const response = await fetch(`${FILE_URL}/${file.file_path}`).catch((error) => {
    throw new TelegramError(0, String(error));
  });
  if (!response.ok) throw new TelegramError(response.status, `HTTP ${response.status}`);
  return await response.blob();
}

export const reply = (chatId: number, text: string, replyTo?: number) =>
  send(chatId, { text, buttons: [] }, replyTo).catch((error) => console.error("telegram reply failed:", errorText(error)));

export async function workspaceName(workspaceId: string): Promise<string> {
  const { data } = await admin.from("workspaces").select("name").eq("id", workspaceId).maybeSingle();
  return data?.name ?? "";
}

export async function activeChats(workspaceId: string): Promise<ChatRow[]> {
  if (!BOT_TOKEN) return [];
  const { data } = await admin.from("telegram_chats").select(CHAT_COLUMNS).eq("workspace_id", workspaceId).eq("status", "active");
  return (data ?? []) as ChatRow[];
}

/** Отправка в чат с одной повторной попыткой, если группа сменила ID. */
async function deliver(chat: ChatRow, message: OutgoingMessage): Promise<number> {
  try {
    return await send(chat.chat_id, message);
  } catch (error) {
    if (!(error instanceof TelegramError) || !error.migrateTo) throw error;
    await admin.from("telegram_chats").update({ chat_id: error.migrateTo }).eq("chat_id", chat.chat_id);
    chat.chat_id = error.migrateTo;
    return await send(chat.chat_id, message);
  }
}

export interface Broadcast {
  /** false — временный сбой (лимит Telegram, сеть): отправку стоит повторить позже. */
  ok: boolean;
  /** Куда сообщение дошло: по этим ID ответ менеджера находит клиента. */
  sent: { chatId: number; messageId: number }[];
}

/** Отправляет сообщение во все активные чаты проекта. Чат, который недоступен навсегда, помечается ошибкой. */
export async function broadcast(chats: ChatRow[], message: OutgoingMessage): Promise<Broadcast> {
  const sent: Broadcast["sent"] = [];
  for (const chat of chats.filter((item) => item.status === "active")) {
    try {
      sent.push({ chatId: chat.chat_id, messageId: await deliver(chat, message) });
      await admin.from("telegram_chats").update({ last_sent_at: new Date().toISOString(), error: null }).eq("id", chat.id);
    } catch (error) {
      if (error instanceof TelegramError && error.permanent) {
        chat.status = "error";
        await admin.from("telegram_chats").update({ status: "error", error: BROKEN_CHAT_NOTE }).eq("id", chat.id);
        continue;
      }
      console.error("telegram send failed:", errorText(error));
      return { ok: false, sent };
    }
  }
  return { ok: true, sent };
}

/**
 * Запоминает, о каком клиенте WhatsApp сообщение бота: ответ менеджера на него уйдёт этому клиенту.
 * channelId — номер WhatsApp компании (lead_channels), waId — номер клиента цифрами.
 */
export async function rememberThread(workspaceId: string, channelId: string, waId: string, sent: Broadcast["sent"]) {
  if (!sent.length) return;
  await admin
    .from("telegram_threads")
    .upsert(sent.map((item) => ({ chat_id: item.chatId, message_id: item.messageId, workspace_id: workspaceId, channel_id: channelId, wa_id: waId })), { onConflict: "chat_id,message_id" });
}

interface LeadRow {
  id: string;
  workspace_id: string;
  name: string;
  phone: string;
  source: string;
  created_at: string;
  raw_payload: { message?: unknown } | null;
  ads: { name: string } | null;
  campaigns: { name: string } | null;
}
const LEAD_NOTICE_COLUMNS = "id, workspace_id, name, phone, source, created_at, raw_payload, ads(name), campaigns(name)";

/** Заявки в том виде, в каком их показывает бот: с объявлением, кампанией и первым сообщением. */
export async function leadNotices(leadIds: string[]): Promise<{ id: string; workspaceId: string; notice: LeadNotice }[]> {
  if (!leadIds.length) return [];
  const { data } = await admin.from("leads").select(LEAD_NOTICE_COLUMNS).in("id", leadIds).order("created_at");
  const rows = (data ?? []) as unknown as LeadRow[];
  const names = new Map<string, string>();
  for (const id of new Set(rows.map((row) => row.workspace_id))) names.set(id, await workspaceName(id));
  return rows.map((row) => {
    const message = row.raw_payload?.message;
    return {
      id: row.id,
      workspaceId: row.workspace_id,
      notice: {
        project: names.get(row.workspace_id) ?? "",
        name: row.name,
        phone: row.phone,
        source: row.source,
        createdAt: row.created_at,
        adName: row.ads?.name ?? null,
        campaignName: row.campaigns?.name ?? null,
        message: typeof message === "string" && message.trim() ? message.trim() : null,
      },
    };
  });
}
