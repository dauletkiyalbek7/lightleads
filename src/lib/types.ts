export type Currency = "USD" | "KZT";
/** Сумма сразу в обеих валютах, сконвертированная по курсу на дату операции. */
export type Dual = Record<Currency, number>;

export type Platform = "meta" | "tiktok";
export type EntityStatus = "active" | "paused";
export type Objective = "leads" | "messages" | "sales" | "awareness" | "traffic";

export type AttributionModel = "last" | "first";
export type AttributionWindow = 7 | 14 | 30 | 60 | 90;

export interface WorkspaceSettings {
  /** Валюта, в которой менеджеры вносят продажи. */
  salesCurrency: Currency;
  /** Средняя маржа, %, если у продажи не указан товар. */
  marginPct: number;
  /** Цели в валюте продаж. null = не заданы. */
  targetCac: number | null;
  targetRomi: number | null;
  attributionModel: AttributionModel;
  attributionWindow: AttributionWindow;
}

export interface Workspace {
  id: string;
  name: string;
  /** role заложен сразу, в v1 все участники видят всё. */
  role: "owner" | "member";
  timezone?: string;
  /** Пока реклама не подключена, workspace показывает демо-данные. */
  demoData?: boolean;
  /** Настройки из базы; у демо-workspace их нет. */
  settings?: WorkspaceSettings;
}

/** Вошедший пользователь. */
export interface SessionUser {
  id: string;
  email: string;
  name: string;
  /** Владелец платформы: создаёт workspace и выдаёт доступы клиентам. */
  isPlatformAdmin: boolean;
}

export interface SessionContext {
  user: SessionUser;
  workspaces: Workspace[];
}

/** Логин и пароль нового аккаунта. password = null, если аккаунт уже существовал. */
export interface Credentials {
  email: string;
  password: string | null;
}

export interface AdAccount {
  id: string;
  platform: Platform;
  name: string;
  externalId: string;
  currency: Currency;
  timezone: string;
  status: "active" | "token_expired";
}

export interface Campaign {
  id: string;
  accountId: string;
  platform: Platform;
  name: string;
  objective: Objective;
  status: EntityStatus;
  dailyBudget: number;
}

export interface AdSet {
  id: string;
  campaignId: string;
  name: string;
  status: EntityStatus;
}

export type CreativeType = "video" | "image" | "carousel";

export interface Creative {
  id: string;
  name: string;
  type: CreativeType;
  title: string;
  body: string;
  cta: string;
  /** Оттенок для сгенерированного превью (в демо нет реальных файлов). */
  hue: number;
  /** Превью из Supabase Storage; в демо его нет. */
  thumbnailUrl?: string;
  durationSec: number | null;
}

export interface Ad {
  id: string;
  adsetId: string;
  campaignId: string;
  accountId: string;
  platform: Platform;
  name: string;
  status: EntityStatus;
  creativeId: string;
  startDate: string;
  endDate: string | null;
}

/** Статистика уровня «объявление × день» в валюте рекламного аккаунта. */
export interface InsightDaily {
  adId: string;
  date: string;
  currency: Currency;
  spend: number;
  impressions: number;
  reach: number;
  clicks: number;
  /** Конверсии по данным пикселя: показываем отдельно, не смешиваем с продажами. */
  pixelPurchases: number;
  pixelValue: number;
  /** Заявки по данным кабинета: лид-формы и событие «лид» пикселя сайта. */
  platformLeads: number;
  /** Переписки, начатые с рекламы «Написать в WhatsApp / Direct», по данным кабинета. */
  messagingStarted: number;
  videoPlays: number;
  video3s: number;
  videoHold: number;
  videoWatchSec: number;
}

export type LeadSource =
  | "meta_form"
  | "tiktok_form"
  | "website"
  | "whatsapp"
  | "instagram"
  | "manual"
  | "sheet";

export interface Lead {
  id: string;
  /** E.164 */
  phone: string;
  name: string;
  source: LeadSource;
  platform: Platform | null;
  campaignId: string | null;
  adsetId: string | null;
  adId: string | null;
  date: string;
  time: string;
  /** Первое сообщение клиента в WhatsApp. */
  message?: string | null;
  /** Комментарий менеджера. */
  note?: string;
}

export interface Product {
  id: string;
  name: string;
  price: number;
  costType: "amount" | "percent";
  cost: number;
  /** Убран из справочника: в списках выбора не показывается, но название у старых продаж остаётся. */
  archived?: boolean;
}

export type SaleInput = "manual" | "csv" | "sheets" | "amocrm" | "bitrix24" | "telegram";

export interface Sale {
  id: string;
  phone: string;
  customerName: string;
  amount: number;
  currency: Currency;
  productId: string | null;
  cost: number;
  date: string;
  comment: string;
  input: SaleInput;
  /** Источник, выбранный менеджером вручную, если лид по телефону не найден. */
  manualAdId: string | null;
  createdBy: string;
}

export interface Member {
  id: string;
  name: string;
  email: string;
  role: "owner" | "member";
  status: "active" | "invited";
}

/** Подключение рекламной платформы (вход через Facebook и т. п.). */
export interface AdConnection {
  platform: Platform;
  status: "active" | "token_expired" | "disconnected";
  /** Имя пользователя платформы, через которого выдан доступ. */
  userName: string;
}

export interface SyncRun {
  id: string;
  accountId: string;
  status: "success" | "error";
  startedAt: string;
  durationSec: number;
  rows: number;
  error: string | null;
}

export interface Dataset {
  today: string;
  accounts: AdAccount[];
  campaigns: Campaign[];
  adsets: AdSet[];
  ads: Ad[];
  creatives: Creative[];
  insights: InsightDaily[];
  leads: Lead[];
  products: Product[];
  sales: Sale[];
  /** date -> курс НБРК, тенге за 1 USD */
  rates: Record<string, number>;
  members: Member[];
  syncRuns: SyncRun[];
}

export interface DateRange {
  from: string;
  to: string;
}
