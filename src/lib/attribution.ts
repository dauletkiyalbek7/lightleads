import { DUPLICATE_DAY_TOLERANCE } from "./config";
import { addDays, diffDays } from "./dates";
import type { AttributionModel, AttributionWindow, Lead, Sale } from "./types";

export interface AttributionSettings {
  model: AttributionModel;
  windowDays: AttributionWindow;
}

export interface Attribution {
  saleId: string;
  /** auto — нашли лид по телефону; manual — источник выбрал менеджер; none — источник не определён. */
  mode: "auto" | "manual" | "none";
  lead: Lead | null;
  adId: string | null;
  /** Касания в окне атрибуции, от раннего к позднему. */
  touches: Lead[];
  /** Вся история касаний по этому номеру (в том числе вне окна). */
  history: Lead[];
}

export type LeadsByPhone = Map<string, Lead[]>;

export function indexLeadsByPhone(leads: Lead[]): LeadsByPhone {
  const map: LeadsByPhone = new Map();
  for (const lead of leads) {
    const list = map.get(lead.phone);
    if (list) list.push(lead);
    else map.set(lead.phone, [lead]);
  }
  for (const list of map.values()) list.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  return map;
}

/** Ищем лиды с тем же телефоном в окне N дней до продажи и берём первое или последнее касание. */
export function attributeSale(
  sale: Pick<Sale, "id" | "phone" | "date" | "manualAdId">,
  leadsByPhone: LeadsByPhone,
  settings: AttributionSettings,
): Attribution {
  const history = leadsByPhone.get(sale.phone) ?? [];
  const windowStart = addDays(sale.date, -settings.windowDays);
  const touches = history.filter((l) => l.date <= sale.date && l.date >= windowStart);
  const lead = touches.length ? (settings.model === "last" ? touches[touches.length - 1] : touches[0]) : null;

  if (lead) return { saleId: sale.id, mode: "auto", lead, adId: lead.adId, touches, history };
  if (sale.manualAdId) return { saleId: sale.id, mode: "manual", lead: null, adId: sale.manualAdId, touches, history };
  return { saleId: sale.id, mode: "none", lead: null, adId: null, touches, history };
}

export function attributeAll(sales: Sale[], leads: Lead[], settings: AttributionSettings): Map<string, Attribution> {
  const byPhone = indexLeadsByPhone(leads);
  return new Map(sales.map((s) => [s.id, attributeSale(s, byPhone, settings)]));
}

/** Дубль: тот же телефон + та же сумма + дата ± 1 день. Не удаляем молча, только предупреждаем. */
export function findDuplicate(
  candidate: Pick<Sale, "phone" | "amount" | "date"> & { id?: string },
  sales: Sale[],
): Sale | null {
  return (
    sales.find(
      (s) =>
        s.id !== candidate.id &&
        s.phone === candidate.phone &&
        s.amount === candidate.amount &&
        Math.abs(diffDays(s.date, candidate.date)) <= DUPLICATE_DAY_TOLERANCE,
    ) ?? null
  );
}
