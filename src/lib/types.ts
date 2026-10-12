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
  | "manual";

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
}

export interface Product {
  id: string;
  name: string;
  price: number;
  costType: "amount" | "percent";
  cost: number;
}

export type SaleInput = "manual" | "csv" | "sheets" | "amocrm" | "bitrix24";

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
