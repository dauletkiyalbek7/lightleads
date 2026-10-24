// Продажа из Telegram: разбор ответа менеджера («45000 английский»), подбор товара и тексты бота.
// Без обращений к сети и базе.
import { escapeHtml, formatPhone, type OutgoingMessage, SALE_CALLBACK } from "./message.ts";

export type Currency = "USD" | "KZT";

export interface ParsedSale {
  amount: number;
  /** Валюта, если менеджер её указал; иначе — валюта продаж проекта. */
  currency: Currency | null;
  /** Что продали, как написал менеджер. */
  product: string;
}

export interface ProductRow {
  id: string;
  name: string;
  price: number;
  cost_type: "amount" | "percent";
  cost: number;
}

const THOUSAND = 1000;
const PERCENT = 100;
const MAX_AMOUNT = 1_000_000_000;
/** Короче этого название товара не сравниваем: «а» найдётся в любом названии. */
const MIN_PRODUCT_MATCH = 3;
const MAX_PRODUCT_TEXT = 200;
const UNDO_CALLBACK = "unsale:";
const undoCallback = (saleId: string) => `${UNDO_CALLBACK}${saleId}`;

/** Что нажали под сообщением бота: записать продажу по лиду или отменить записанную. */
export function parseCallback(data: string): { kind: "sale" | "undo"; id: string } | null {
  if (data.startsWith(SALE_CALLBACK)) return { kind: "sale", id: data.slice(SALE_CALLBACK.length) };
  if (data.startsWith(UNDO_CALLBACK)) return { kind: "undo", id: data.slice(UNDO_CALLBACK.length) };
  return null;
}

// Сумма: «45000», «45 000», «45.000», «12.5», «45к»; валюта до или после суммы; дальше — что продали
const SALE_RE =
  /^\s*(\$)?\s*(\d{1,3}(?:[ .,\u00a0\u202f]\d{3})+|\d+(?:[.,]\d{1,2})?)\s*(к|k|тыс\.?)?\s*(\$|usd|долл\S*|₸|тг|тенге|kzt)?(?=\s|$|[,;:—-])[\s,;:—-]*(.*)$/isu;

export function parseSale(text: string): ParsedSale | null {
  const match = SALE_RE.exec(text);
  if (!match) return null;
  const [, dollarSign, rawNumber, thousands, currencyWord, rest] = match;
  const grouped = /^\d{1,3}(?:[ .,\u00a0\u202f]\d{3})+$/.test(rawNumber);
  const number = grouped ? Number(rawNumber.replace(/\D/g, "")) : Number(rawNumber.replace(",", "."));
  const amount = Math.round(number * (thousands ? THOUSAND : 1) * PERCENT) / PERCENT;
  if (!(amount > 0) || amount >= MAX_AMOUNT) return null;
  const word = (currencyWord ?? "").toLowerCase();
  const currency: Currency | null = dollarSign || word === "$" || word === "usd" || word.startsWith("долл") ? "USD" : word ? "KZT" : null;
  return { amount, currency, product: rest.trim().slice(0, MAX_PRODUCT_TEXT) };
}

/** Товар из справочника проекта, о котором написал менеджер: самое длинное совпадение названия. */
export function matchProduct(text: string, products: ProductRow[]): ProductRow | null {
  const said = text.trim().toLowerCase();
  if (said.length < MIN_PRODUCT_MATCH) return null;
  let best: ProductRow | null = null;
  for (const product of products) {
    const name = product.name.trim().toLowerCase();
    if (name.length < MIN_PRODUCT_MATCH) continue;
    if ((said.includes(name) || name.includes(said)) && (!best || name.length > best.name.length)) best = product;
  }
  return best;
}

/** Себестоимость как в форме продажи на сайте: из товара, а без товара — по средней марже проекта. */
export function saleCost(amount: number, product: ProductRow | null, marginPct: number): number {
  if (product) return Math.round(product.cost_type === "amount" ? Number(product.cost) : (Number(product.price) * Number(product.cost)) / PERCENT);
  return Math.round(amount * (1 - marginPct / PERCENT));
}

/** Сегодняшняя дата «ГГГГ-ММ-ДД» в часовом поясе проекта. */
export const todayIn = (timeZone: string, now = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone }).format(now);

const SYMBOL: Record<Currency, string> = { USD: "$", KZT: "₸" };

/** «45 000 ₸», «$300,5». */
export function formatAmount(amount: number, currency: Currency): string {
  const number = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(amount).replace(/[\u00a0\u202f]/g, " ");
  return currency === "USD" ? `${SYMBOL.USD}${number}` : `${number} ${SYMBOL.KZT}`;
}

const EXAMPLE = "45000 английский";

/** Вопрос после нажатия «✅ Продажа»: менеджер отвечает на него суммой. */
export function salePrompt(name: string, phone: string): OutgoingMessage {
  const who = `<b>${escapeHtml(name || "Без имени")}</b> · ${formatPhone(phone)}`;
  return {
    text: `💰 Продажа: ${who}\n\nОтветьте на это сообщение суммой и тем, что купили. Например: <code>${EXAMPLE}</code>\nВ долларах — со знаком $: <code>$300 курс</code>`,
    buttons: [],
    forceReply: EXAMPLE,
  };
}

export const SALE_HELP = `Не понял сумму. Ответьте на вопрос бота так: <code>${EXAMPLE}</code> или <code>$300 курс</code>.`;
export const DEMO_SALE_NOTE = "Это пример. Под настоящей заявкой эта кнопка запишет продажу в LightLeads.";

export interface SavedSale {
  id: string;
  name: string;
  amount: number;
  currency: Currency;
  /** Товар из справочника или как его назвал менеджер. */
  product: string;
  seller: string;
}

export function saleSavedMessage(sale: SavedSale): OutgoingMessage {
  const lines = [`✅ <b>Продажа записана</b>: ${formatAmount(sale.amount, sale.currency)}`];
  if (sale.product) lines.push(escapeHtml(sale.product));
  lines.push(`Клиент: ${escapeHtml(sale.name || "Без имени")}`);
  if (sale.seller) lines.push(`Продавец: ${escapeHtml(sale.seller)}`);
  return { text: lines.join("\n"), buttons: [{ text: "Отменить", callback_data: undoCallback(sale.id) }] };
}

export const saleUndoneText = (amount: number, currency: Currency) => `↩️ Продажа ${formatAmount(amount, currency)} отменена.`;
