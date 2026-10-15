import { callFunction } from "./supabase/functions";

/**
 * Запросы к Edge Function `telegram` (supabase/functions/telegram): бот LightLeads присылает новые заявки
 * проекта в чаты Telegram. Участник проекта получает ссылку на бота с одноразовым кодом и подключает
 * по ней свой личный чат или группу отдела продаж.
 */
const FUNCTION = "telegram";

export interface TelegramChat {
  id: string;
  title: string;
  kind: "private" | "group";
  status: "active" | "error";
  error: string | null;
  lastSentAt: string | null;
  createdAt: string;
}

export interface TelegramStatus {
  /** Владелец платформы задал токен бота. */
  configured: boolean;
  bot: string | null;
  chats: TelegramChat[];
}

export interface TelegramLinks {
  bot: string;
  privateUrl: string;
  groupUrl: string;
}

/** Для владельца платформы: работает ли бот. lastError — что Telegram ответил на последнюю попытку. */
export interface TelegramBotInfo {
  configured: boolean;
  bot: string | null;
  lastError: string | null;
}

export const telegramStatus = (workspaceId: string) => callFunction<TelegramStatus>(FUNCTION, { action: "status", workspaceId });

export const telegramLink = (workspaceId: string) => callFunction<TelegramLinks>(FUNCTION, { action: "link", workspaceId });

export const telegramTest = (workspaceId: string, chatId: string) => callFunction<{ ok: boolean }>(FUNCTION, { action: "test", workspaceId, chatId });

export const telegramUnlink = (workspaceId: string, chatId: string) => callFunction<{ ok: boolean }>(FUNCTION, { action: "unlink", workspaceId, chatId });

export const telegramBotInfo = () => callFunction<TelegramBotInfo>(FUNCTION, { action: "bot_info" });
