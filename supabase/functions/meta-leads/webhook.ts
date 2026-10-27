// Уведомления Meta: проверка подписи и разбор. Без обращений к сети и базе.
//   object = "page", field = "leadgen"                        — новая заявка из лид-формы страницы
//   object = "whatsapp_business_account", field = "messages"  — входящее сообщение WhatsApp

const encoder = new TextEncoder();
const SIGNATURE_PREFIX = "sha256=";
const VERIFY_TOKEN_LENGTH = 32;
const SECOND_MS = 1000;
/** Тип источника в сообщении WhatsApp: клиент написал, нажав на объявление. */
const AD_SOURCE = "ad";
/** Что из описания объявления сохраняем вместе с лидом. */
const REFERRAL_KEYS = ["source_id", "source_url", "headline", "ctwa_clid"];
/** Текст первого сообщения клиента храним коротким: это подсказка менеджеру, а не переписка. */
const MAX_TEXT_LENGTH = 500;

type Json = Record<string, unknown>;
const obj = (value: unknown): Json => (value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : {});
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const text = (value: unknown): string => (typeof value === "string" || typeof value === "number" ? String(value).trim() : "");

/** «0» и пустая строка вместо ID значат «нет». */
const idOrNull = (value: unknown): string | null => {
  const id = text(value);
  return id && id !== "0" ? id : null;
};

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

const base64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromBase64url = (text: string) => atob(text.replace(/-/g, "+").replace(/_/g, "/"));

/** Сравнение строк без раннего выхода: время ответа не подсказывает, сколько символов совпало. */
function sameText(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Запрос Meta на удаление данных (Data Deletion Callback): поле signed_request вида «подпись.данные»,
 * подписанное секретом приложения. Возвращает ID пользователя Facebook или null, если подпись неверна.
 */
export async function parseSignedRequest(appSecret: string, signedRequest: string): Promise<string | null> {
  const [signature, payload] = signedRequest.split(".");
  if (!appSecret || !signature || !payload) return null;
  const key = await crypto.subtle.importKey("raw", encoder.encode(appSecret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const expected = base64url(new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(payload))));
  if (!sameText(expected, signature)) return null;
  try {
    const data = obj(JSON.parse(fromBase64url(payload)));
    if (text(data.algorithm).toUpperCase() !== "HMAC-SHA256") return null;
    return idOrNull(data.user_id);
  } catch {
    return null;
  }
}

/** Подпись уведомления: Meta подписывает тело запроса секретом приложения (заголовок X-Hub-Signature-256). */
export async function verifySignature(appSecret: string, body: string, header: string | null): Promise<boolean> {
  if (!appSecret || !header?.startsWith(SIGNATURE_PREFIX)) return false;
  const expected = await hmacHex(appSecret, body);
  return sameText(expected, header.slice(SIGNATURE_PREFIX.length).toLowerCase());
}

/**
 * Проверочная строка, которую владелец платформы вписывает в настройки вебхука приложения Meta.
 * Выводится из секрета приложения, поэтому нигде не хранится и сам секрет не раскрывает.
 */
export const verifyToken = async (appSecret: string) => (await hmacHex(appSecret, "lightleads-webhook-verify")).slice(0, VERIFY_TOKEN_LENGTH);

/** Новая заявка из лид-формы: сами ответы формы нужно дочитать по leadId. */
export interface FormNotice {
  leadId: string;
  pageId: string;
  formId: string | null;
  /** ID объявления; null — заявка не с рекламы (например, проверочная). */
  adId: string | null;
}

/** Фото, видео, аудио или документ клиента: сам файл скачивается у Meta по id. */
export interface WhatsAppMedia {
  id: string;
  type: "image" | "video" | "audio" | "document";
  /** Аудио, записанное в WhatsApp голосом. */
  voice: boolean;
  mimeType: string;
  /** Название документа; у фото и голосовых его нет. */
  filename: string | null;
}

/** Входящее сообщение клиента на номер компании в WhatsApp. */
export interface IncomingMessage {
  /** ID номера WhatsApp компании, на который написали. */
  numberId: string;
  messageId: string;
  /** Номер клиента: только цифры, с кодом страны. */
  from: string;
  name: string;
  /** ID объявления, если клиент написал, нажав на рекламу «Написать в WhatsApp»; иначе null. */
  adId: string | null;
  sentAt: string;
  /** Текст сообщения или подпись к вложению: «📷 Фото», «🎤 Голосовое сообщение». */
  text: string;
  /** Вложение, которое можно переслать файлом; стикеры и прочее — только подписью. */
  media: WhatsAppMedia | null;
  referral: Record<string, string>;
}

export interface ParsedWebhook {
  forms: FormNotice[];
  messages: IncomingMessage[];
}

/** Как показать сообщение без текста. */
const MEDIA_LABELS: Record<string, string> = {
  image: "📷 Фото",
  video: "🎬 Видео",
  audio: "🎤 Голосовое сообщение",
  voice: "🎤 Голосовое сообщение",
  document: "📄 Документ",
  sticker: "Стикер",
  location: "📍 Геопозиция",
  contacts: "👤 Контакт",
  reaction: "Реакция",
};

const MEDIA_TYPES = new Set<string>(["image", "video", "audio", "document"]);

/** Геопозиция — ссылкой на карту, контакт — именем и номером: менеджер видит их сразу. */
function placeOrContact(message: Json): string {
  const location = obj(message.location);
  const lat = text(location.latitude);
  const lng = text(location.longitude);
  if (lat && lng) return [text(location.name), text(location.address), `https://maps.google.com/?q=${lat},${lng}`].filter(Boolean).join(", ");
  return list(message.contacts)
    .map((item) => [text(obj(obj(item).name).formatted_name), ...list(obj(item).phones).map((phone) => text(obj(phone).phone))].filter(Boolean).join(" "))
    .filter(Boolean)
    .join("; ");
}

/** Текст сообщения любого вида: обычный текст, нажатая кнопка, подпись к фото или название вложения. */
function messageText(message: Json): string {
  const type = text(message.type);
  const body =
    text(obj(message.text).body) ||
    text(obj(message.button).text) ||
    text(obj(obj(message.interactive).button_reply).title) ||
    text(obj(obj(message.interactive).list_reply).title) ||
    text(obj(message[type]).caption) ||
    placeOrContact(message);
  const label = MEDIA_LABELS[type] ?? "";
  const combined = body && label ? `${label}: ${body}` : body || label || (type ? `Сообщение (${type})` : "");
  return combined.slice(0, MAX_TEXT_LENGTH);
}

function mediaOf(message: Json): WhatsAppMedia | null {
  const type = text(message.type);
  const media = obj(message[type]);
  const id = text(media.id);
  if (!MEDIA_TYPES.has(type) || !id) return null;
  return { id, type: type as WhatsAppMedia["type"], voice: media.voice === true, mimeType: text(media.mime_type), filename: text(media.filename) || null };
}

function formNotice(value: Json): FormNotice | null {
  const leadId = idOrNull(value.leadgen_id);
  const pageId = idOrNull(value.page_id);
  if (!leadId || !pageId) return null;
  return { leadId, pageId, formId: idOrNull(value.form_id), adId: idOrNull(value.ad_id) };
}

function incoming(value: Json): IncomingMessage[] {
  const numberId = text(obj(value.metadata).phone_number_id);
  if (!numberId) return [];
  const names = new Map(list(value.contacts).map((contact) => [text(obj(contact).wa_id), text(obj(obj(contact).profile).name)]));
  const messages: IncomingMessage[] = [];
  for (const item of list(value.messages)) {
    const message = obj(item);
    const referral = obj(message.referral);
    const from = text(message.from).replace(/\D/g, "");
    const messageId = text(message.id);
    // Реакции и служебные сообщения (смена номера, системные) — не переписка
    if (!from || !messageId || ["reaction", "system", "unsupported"].includes(text(message.type))) continue;
    const sentMs = Number(text(message.timestamp)) * SECOND_MS;
    messages.push({
      numberId,
      messageId,
      from,
      name: names.get(text(message.from)) ?? "",
      // Объявление — только для перехода с рекламы, не с обычной публикации
      adId: text(referral.source_type) === AD_SOURCE ? idOrNull(referral.source_id) : null,
      sentAt: new Date(Number.isFinite(sentMs) && sentMs > 0 ? sentMs : Date.now()).toISOString(),
      text: messageText(message),
      media: mediaOf(message),
      referral: Object.fromEntries(REFERRAL_KEYS.map((key) => [key, text(referral[key])]).filter(([, v]) => v)),
    });
  }
  return messages;
}

export function parseWebhook(payload: unknown): ParsedWebhook {
  const root = obj(payload);
  const parsed: ParsedWebhook = { forms: [], messages: [] };
  for (const entry of list(root.entry)) {
    for (const item of list(obj(entry).changes)) {
      const change = obj(item);
      if (root.object === "page" && change.field === "leadgen") {
        const notice = formNotice(obj(change.value));
        if (notice) parsed.forms.push(notice);
      } else if (root.object === "whatsapp_business_account" && change.field === "messages") {
        parsed.messages.push(...incoming(obj(change.value)));
      }
    }
  }
  return parsed;
}

/** Ответы лид-формы объектом «название поля → значение»: в таком виде их разбирает общий разбор заявок. */
export function fieldsOf(fieldData: unknown): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const item of list(fieldData)) {
    const name = text(obj(item).name);
    if (name) fields[name] = text(list(obj(item).values)[0]);
  }
  return fields;
}
