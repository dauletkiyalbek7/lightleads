import { callFunction } from "./supabase/functions";

/**
 * Запросы к Edge Function `meta-leads` (supabase/functions/meta-leads): лиды из лид-форм страниц Facebook
 * и из WhatsApp (Cloud API). Владелец выдаёт LightLeads дополнительные права Facebook и выбирает,
 * какие страницы и номера относятся к этой компании.
 */
const FUNCTION = "meta-leads";

/** Страница Facebook с лид-формами или номер WhatsApp. */
export type ChannelKind = "meta_page" | "whatsapp";
export const CHANNEL_KINDS: ChannelKind[] = ["meta_page", "whatsapp"];
/** Какой набор прав Facebook нужен каналу. */
const FEATURE: Record<ChannelKind, "forms" | "whatsapp"> = { meta_page: "forms", whatsapp: "whatsapp" };
/** Без этих прав канал не подключить. Список совпадает с проверкой на сервере. */
const REQUIRED_SCOPES: Record<ChannelKind, string[]> = {
  meta_page: ["pages_show_list", "pages_manage_metadata", "leads_retrieval"],
  whatsapp: ["whatsapp_business_management"],
};

/**
 * После выдачи прав Facebook возвращает браузер на «Настройки». Отметка в sessionStorage говорит,
 * что вернуться нужно на вкладку источников лидов, а окно выбора рекламных кабинетов открывать не надо.
 */
export const OAUTH_RETURN_KEY = "ll-oauth-return";
export const OAUTH_RETURN_LEADS = "leadSources";

export const hasChannelAccess = (kind: ChannelKind, scopes: string[]) => REQUIRED_SCOPES[kind].every((scope) => scopes.includes(scope));

export interface ChannelOption {
  id: string;
  name: string;
  /** Для номера WhatsApp — сам номер. */
  detail: string;
  selected: boolean;
  /** Уже подключено к другой компании в LightLeads. */
  taken: boolean;
}

export interface ChannelSelection {
  added: number;
  removed: number;
  /** Названия, которые не подключились: они уже заняты другой компанией. */
  taken: string[];
  /** Сколько прошлых заявок загрузилось сразу после подключения страниц. */
  leads: number;
}

export const metaLeadsStart = (workspaceId: string, kind: ChannelKind) =>
  callFunction<{ url: string }>(FUNCTION, { action: "start", workspaceId, feature: FEATURE[kind], origin: window.location.origin });

export const metaLeadsOptions = (workspaceId: string, kind: ChannelKind) => callFunction<{ options: ChannelOption[] }>(FUNCTION, { action: "options", workspaceId, kind });

export const metaLeadsSelect = (workspaceId: string, kind: ChannelKind, ids: string[]) => callFunction<ChannelSelection>(FUNCTION, { action: "select", workspaceId, kind, ids });

/** Что вписать в настройки приложения Meta: вебхук, политика конфиденциальности, удаление данных. Только для владельца платформы. */
export interface MetaAppSettings {
  callbackUrl: string;
  verifyToken: string;
  privacyUrl: string;
  deletionUrl: string;
}

export const metaWebhookInfo = () => callFunction<MetaAppSettings>(FUNCTION, { action: "webhook_info" });
