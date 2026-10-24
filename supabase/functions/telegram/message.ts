// Сообщения бота LightLeads в Telegram: текст заявки, сводка, разбор команды /start.
// Без обращений к сети и базе.
import { parsePhoneNumberFromString } from "npm:libphonenumber-js@1.13.15/min";

const encoder = new TextEncoder();
/** Часовой пояс времени заявки в сообщении: как на экранах приложения. */
const TIME_ZONE = "Asia/Almaty";
const MAX_MESSAGE_LENGTH = 300;
/** Сообщение клиента в переписке показываем целиком, но не длиннее предела Telegram (4096). */
const MAX_CHAT_TEXT_LENGTH = 3500;
const MAX_LINE_LENGTH = 80;
/** Столько заявок перечисляем в сводке; об остальных — только число. */
export const SUMMARY_LINES = 10;
/** Код из ссылки на бота: Telegram разрешает в нём только латиницу, цифры, «_» и «-». */
const START_RE = /^\/start(?:@\w+)?(?:\s+([A-Za-z0-9_-]{1,64}))?\s*$/;

export const SOURCE_LABELS: Record<string, string> = {
  meta_form: "Лид-форма Facebook / Instagram",
  tiktok_form: "Лид-форма TikTok",
  website: "Сайт",
  whatsapp: "WhatsApp",
  instagram: "Instagram Direct",
  sheet: "Google-таблица",
  manual: "Добавлен вручную",
};

export interface LeadNotice {
  project: string;
  name: string;
  /** E.164 */
  phone: string;
  source: string;
  createdAt: string;
  adName: string | null;
  campaignName: string | null;
  /** Первое сообщение клиента в WhatsApp. */
  message: string | null;
}

/** Кнопка-ссылка или кнопка, нажатие которой бот получает в callback_query. */
export type Button = { text: string; url: string } | { text: string; callback_data: string };

export interface OutgoingMessage {
  text: string;
  buttons: Button[];
  /** Попросить ответить на это сообщение; значение — подсказка в поле ввода. */
  forceReply?: string;
}

/** Нажали «✅ Продажа» под заявкой: в callback_data — ID лида. */
export const SALE_CALLBACK = "sale:";
/** Заявка из проверочного сообщения: её нет в базе, кнопка «Продажа» только объясняет, что будет. */
export const DEMO_LEAD = "demo";
const saleButton = (leadId: string): Button => ({ text: "✅ Продажа", callback_data: `${SALE_CALLBACK}${leadId}` });

export const escapeHtml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/** «+77011234567» → «+7 701 123 4567». */
export const formatPhone = (phone: string) => parsePhoneNumberFromString(phone)?.formatInternational() ?? phone;

/** Ссылка, которая открывает переписку с клиентом в WhatsApp на телефоне менеджера. */
export const whatsappLink = (phone: string) => `https://wa.me/${phone.replace(/\D/g, "")}`;

/** «15.10, 14:32» по Алматы. */
export function formatTime(iso: string): string {
  const parts = new Intl.DateTimeFormat("ru-RU", { timeZone: TIME_ZONE, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date(iso));
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("day")}.${part("month")}, ${part("hour")}:${part("minute")}`;
}

/** Код подключения из команды «/start КОД» или «/start@бот КОД». "" — команда без кода, null — это не /start. */
export function parseStart(text: string): string | null {
  const match = START_RE.exec(text.trim());
  return match ? (match[1] ?? "") : null;
}

/** Строка, которую Telegram присылает в заголовке вебхука: выводится из токена бота и нигде не хранится. */
export async function webhookSecret(botToken: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(botToken), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode("lightleads-telegram-webhook"));
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Сравнение строк без раннего выхода. */
export function sameText(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const leadsButton = (appUrl: string): Button => ({ text: "Открыть в LightLeads", url: `${appUrl}/leads` });

/** Под сообщениями клиентов WhatsApp: как ему ответить. */
export const REPLY_HINT = "↩️ Ответьте на это сообщение — ответ уйдёт клиенту в WhatsApp с номера компании.";

/**
 * Карточка новой заявки. replyable — клиент написал на номер компании в WhatsApp Cloud API:
 * отвечают ему ответом на эту карточку, поэтому кнопки «Написать в WhatsApp» с личного номера нет.
 * leadId — заявка в базе: под карточкой появляется кнопка «✅ Продажа».
 */
export function leadMessage(lead: LeadNotice, appUrl: string, replyable = false, leadId?: string): OutgoingMessage {
  const lines = [`🔔 <b>Новая заявка</b> · ${escapeHtml(lead.project)}`, "", `<b>${escapeHtml(lead.name || "Без имени")}</b>`, formatPhone(lead.phone)];
  if (lead.message) lines.push(`💬 «${escapeHtml(clip(lead.message, MAX_MESSAGE_LENGTH))}»`);
  lines.push("", `Источник: ${escapeHtml(SOURCE_LABELS[lead.source] ?? lead.source)}`);
  if (lead.adName) lines.push(`Объявление: ${escapeHtml(lead.adName)}`);
  if (lead.campaignName) lines.push(`Кампания: ${escapeHtml(lead.campaignName)}`);
  lines.push(`Время: ${formatTime(lead.createdAt)}`);
  const sale = leadId ? [saleButton(leadId)] : [];
  if (replyable) return { text: [...lines, "", REPLY_HINT].join("\n"), buttons: [...sale, leadsButton(appUrl)] };
  return { text: lines.join("\n"), buttons: [...sale, { text: "Написать в WhatsApp", url: whatsappLink(lead.phone) }, leadsButton(appUrl)] };
}

/** Следующее сообщение клиента в WhatsApp: он уже есть в заявках, поэтому коротко. leadId — его последняя заявка. */
export function chatMessage(project: string, name: string, phone: string, text: string, leadId?: string): OutgoingMessage {
  const who = `<b>${escapeHtml(name || "Без имени")}</b> · ${formatPhone(phone)} · ${escapeHtml(project)}`;
  return { text: `💬 ${who}\n${escapeHtml(clip(text, MAX_CHAT_TEXT_LENGTH))}`, buttons: leadId ? [saleButton(leadId)] : [] };
}

/** Много заявок сразу (например, загрузили таблицу): одно сообщение вместо десятков. */
export function summaryMessage(project: string, leads: LeadNotice[], appUrl: string): OutgoingMessage {
  const lines = [`🔔 <b>Новых заявок: ${leads.length}</b> · ${escapeHtml(project)}`, ""];
  for (const lead of leads.slice(0, SUMMARY_LINES)) {
    const who = clip(lead.name || "Без имени", MAX_LINE_LENGTH);
    lines.push(`• ${escapeHtml(who)} — ${formatPhone(lead.phone)} (${escapeHtml(SOURCE_LABELS[lead.source] ?? lead.source)})`);
  }
  if (leads.length > SUMMARY_LINES) lines.push(`и ещё ${leads.length - SUMMARY_LINES}`);
  return { text: lines.join("\n"), buttons: [leadsButton(appUrl)] };
}

/** Пример заявки для кнопки «Проверить». */
export function testMessage(project: string, appUrl: string): OutgoingMessage {
  const sample = leadMessage(
    { project, name: "Пример: Айгерим", phone: "+77011234567", source: "whatsapp", createdAt: new Date().toISOString(), adName: "Название объявления", campaignName: null, message: "Здравствуйте! Сколько стоит?" },
    appUrl,
    false,
    DEMO_LEAD,
  );
  return { ...sample, text: `<i>Проверка: так будут выглядеть заявки.</i>\n\n${sample.text}` };
}
