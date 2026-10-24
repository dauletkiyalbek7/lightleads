import { HISTORY_DAYS } from "../config";
import { rateOn } from "../currency";
import { addDays, diffDays, weekday } from "../dates";
import type {
  Ad,
  AdAccount,
  AdSet,
  Campaign,
  Creative,
  CreativeType,
  Currency,
  Dataset,
  InsightDaily,
  Lead,
  LeadSource,
  Member,
  Objective,
  Platform,
  Product,
  Sale,
  SaleInput,
  SyncRun,
} from "../types";

/**
 * Детерминированный демо-сид: 2 аккаунта (USD и KZT), 6 кампаний, 40 объявлений,
 * 300 лидов, 80 продаж. Данные привязаны к «сегодня», поэтому демо всегда выглядит свежим.
 * В Фазе 1+ этот модуль заменяется чтением из Supabase — интерфейс Dataset остаётся.
 */

export const DEFAULT_MARGIN_PCT = 55;
export const DEMO_SALES_CURRENCY: Currency = "KZT";

const SEED = 20261012;
const TOTAL_LEADS = 300;
const LEADS_WITHOUT_AD = 10;
const DUPLICATE_PHONE_LEADS = 12;
const ATTRIBUTED_SALES = 68;
const REPEAT_SALES = 4;
const UNATTRIBUTED_SALES = 12;
const UNATTRIBUTED_WITH_MANUAL_SOURCE = 3;

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Archetype = "leader" | "growing" | "fatigue" | "burner" | "lowdata" | "average";

interface ArchetypeProfile {
  leadWeight: number;
  cplMult: number;
  conv: number;
  ctr: number;
  hook: number;
  /** Сколько дней назад стартовало объявление: [от, до] */
  startAgo: [number, number];
}

const PROFILES: Record<Archetype, ArchetypeProfile> = {
  leader: { leadWeight: 4.6, cplMult: 0.66, conv: 0.44, ctr: 0.026, hook: 0.39, startAgo: [84, 89] },
  growing: { leadWeight: 2.3, cplMult: 0.82, conv: 0.38, ctr: 0.021, hook: 0.34, startAgo: [20, 30] },
  fatigue: { leadWeight: 1.5, cplMult: 1.3, conv: 0.2, ctr: 0.022, hook: 0.24, startAgo: [58, 76] },
  burner: { leadWeight: 0.5, cplMult: 6.5, conv: 0, ctr: 0.007, hook: 0.13, startAgo: [38, 60] },
  lowdata: { leadWeight: 0.1, cplMult: 1, conv: 0.15, ctr: 0.015, hook: 0.26, startAgo: [2, 5] },
  average: { leadWeight: 0.8, cplMult: 1.1, conv: 0.2, ctr: 0.014, hook: 0.25, startAgo: [44, 88] },
};

interface CampaignTemplate {
  id: string;
  accountId: string;
  name: string;
  objective: Objective;
  status: "active" | "paused";
  dailyBudget: number;
  source: LeadSource;
  adsets: { name: string; ads: Archetype[] }[];
}

const ACCOUNTS: AdAccount[] = [
  {
    id: "acc_meta",
    platform: "meta",
    name: "Aroma House — Meta",
    externalId: "act_1048220915573",
    currency: "USD",
    timezone: "Asia/Almaty",
    status: "active",
  },
  {
    id: "acc_tiktok",
    platform: "tiktok",
    name: "Aroma House KZ — TikTok",
    externalId: "7312904455180",
    currency: "KZT",
    timezone: "Asia/Almaty",
    status: "active",
  },
];

const CAMPAIGNS: CampaignTemplate[] = [
  {
    id: "c1",
    accountId: "acc_meta",
    name: "Лиды | Лид-форма | Алматы",
    objective: "leads",
    status: "active",
    dailyBudget: 18,
    source: "meta_form",
    adsets: [
      { name: "Ж 25–44 | Интересы: парфюмерия", ads: ["leader", "average", "growing", "average"] },
      { name: "LAL 1% | покупатели", ads: ["leader", "average", "fatigue", "average"] },
      { name: "Широкая | Алматы +40 км", ads: ["average", "burner", "lowdata"] },
    ],
  },
  {
    id: "c2",
    accountId: "acc_meta",
    name: "Сообщения | WhatsApp | Казахстан",
    objective: "messages",
    status: "active",
    dailyBudget: 14,
    source: "whatsapp",
    adsets: [
      { name: "Ж 22–40 | Астана, Шымкент", ads: ["leader", "growing", "average", "average"] },
      { name: "Ретаргет | вовлечённые 30 дн.", ads: ["fatigue", "average", "lowdata"] },
    ],
  },
  {
    id: "c3",
    accountId: "acc_meta",
    name: "Продажи | Сайт | Ретаргет",
    objective: "sales",
    status: "active",
    dailyBudget: 12,
    source: "website",
    adsets: [
      { name: "Посетители сайта 14 дн.", ads: ["leader", "average", "growing"] },
      { name: "Корзина без покупки", ads: ["average", "lowdata"] },
    ],
  },
  {
    id: "c4",
    accountId: "acc_meta",
    name: "Охват | Новая коллекция",
    objective: "awareness",
    status: "paused",
    dailyBudget: 10,
    source: "instagram",
    adsets: [
      { name: "Ж 18–34 | Казахстан", ads: ["burner", "burner", "average"] },
      { name: "М 25–45 | подарки", ads: ["burner", "lowdata"] },
    ],
  },
  {
    id: "c5",
    accountId: "acc_tiktok",
    name: "Лиды | Instant Form | 18–34",
    objective: "leads",
    status: "active",
    dailyBudget: 6500,
    source: "tiktok_form",
    adsets: [
      { name: "Широкая | KZ", ads: ["leader", "growing", "average", "fatigue"] },
      { name: "Интересы: красота и уход", ads: ["average", "burner", "average"] },
    ],
  },
  {
    id: "c6",
    accountId: "acc_tiktok",
    name: "Трафик на сайт | Spark Ads",
    objective: "traffic",
    status: "active",
    dailyBudget: 5000,
    source: "website",
    adsets: [
      { name: "Spark | блогеры", ads: ["growing", "average", "fatigue"] },
      { name: "Ретаргет | просмотры 6с", ads: ["average", "lowdata"] },
    ],
  },
];

const PAUSED_CAMPAIGN_ENDED_AGO = 12;

interface CreativePattern {
  name: string;
  type: CreativeType;
  title: string;
  body: string;
  cta: string;
}

const CREATIVE_PATTERNS: CreativePattern[] = [
  { name: "Видео_отзыв", type: "video", title: "«Аромат держится весь день»", body: "Реальный отзыв клиентки: как она выбрала свой аромат за 5 минут в WhatsApp.", cta: "Написать" },
  { name: "Распаковка", type: "video", title: "Распаковка подарочного сета", body: "Показываем, что внутри коробки: 5 миниатюр, открытка и пробник в подарок.", cta: "Заказать" },
  { name: "UGC_блогер", type: "video", title: "Блогер тестирует 3 аромата", body: "Честный обзор: какой аромат выбрать на осень и почему.", cta: "Подробнее" },
  { name: "Статика_скидка", type: "image", title: "−20% на второй флакон", body: "Только до конца недели. Доставка по Казахстану за 1–3 дня.", cta: "Получить скидку" },
  { name: "Карусель_хиты", type: "carousel", title: "Топ-5 ароматов месяца", body: "Листайте карусель: хиты продаж и новинки коллекции.", cta: "Смотреть каталог" },
  { name: "До_после", type: "video", title: "Как звучит аромат через 8 часов", body: "Тест стойкости: утро, обед и вечер одного дня.", cta: "Подобрать аромат" },
  { name: "Тренд_звук", type: "video", title: "Собери свой сет за 15 секунд", body: "Трендовый звук + быстрый монтаж: три шага до заказа.", cta: "Оставить заявку" },
  { name: "Подборка_ароматов", type: "video", title: "5 ароматов на каждый день", body: "Короткая подборка от нашего парфюмера с ценами.", cta: "Узнать цену" },
  { name: "Основатель", type: "video", title: "Почему мы делаем миниатюры", body: "Основатель бренда рассказывает, как появилась идея наборов 5×10 мл.", cta: "Подробнее" },
  { name: "Подарочный_сет", type: "image", title: "Подарок, который точно понравится", body: "Подарочный сет с бесплатной упаковкой и открыткой.", cta: "Заказать подарок" },
];

const TIKTOK_PATTERNS = CREATIVE_PATTERNS.filter((p) => p.type === "video");

const PRODUCTS: Product[] = [
  { id: "p1", name: "Парфюм 50 мл", price: 32000, costType: "amount", cost: 13500 },
  { id: "p2", name: "Парфюм 100 мл", price: 54000, costType: "amount", cost: 21000 },
  { id: "p3", name: "Набор миниатюр 5×10 мл", price: 18500, costType: "percent", cost: 40 },
  { id: "p4", name: "Подарочный сет", price: 89000, costType: "amount", cost: 38000 },
  { id: "p5", name: "Диффузор для дома", price: 24000, costType: "percent", cost: 45 },
];
const PRODUCT_WEIGHTS = [34, 22, 20, 12, 12];

const MEMBERS: Member[] = [
  { id: "m1", name: "Даулет К.", email: "daulet@aromahouse.kz", role: "owner", status: "active" },
  { id: "m2", name: "Айгерим С.", email: "aigerim@aromahouse.kz", role: "member", status: "active" },
  { id: "m3", name: "Тимур А.", email: "timur@aromahouse.kz", role: "member", status: "active" },
  { id: "m4", name: "Мадина Р.", email: "madina@aromahouse.kz", role: "member", status: "invited" },
];
const SALES_MANAGERS = ["Айгерим С.", "Тимур А.", "Даулет К."];

const FIRST_NAMES = [
  "Айгерим", "Алия", "Асель", "Дана", "Динара", "Жанна", "Камила", "Мадина", "Сабина", "Салтанат",
  "Томирис", "Анна", "Екатерина", "Ольга", "Виктория", "Мария", "Алина", "Диана", "Зарина", "Гульнара",
  "Арман", "Ерлан", "Данияр", "Тимур", "Нурлан", "Руслан", "Алексей", "Бауыржан", "Санжар", "Азамат",
];
const LAST_INITIALS = "АБДЕЖИКМНОРСТУШ".split("");
const MOBILE_PREFIXES = ["700", "701", "702", "705", "707", "708", "747", "771", "775", "776", "777", "778"];

const BASE_CPL: Record<Platform, number> = { meta: 7.2, tiktok: 2950 };
const BASE_CPM: Record<Platform, [number, number]> = { meta: [2.2, 3.6], tiktok: [620, 1100] };
/** Во сколько раз лидов в кабинете больше, чем дошло до LightLeads. */
const AD_LEADS_OVERCOUNT = 1.18;
const KZT_PER_USD_START = 507;
const RATE_HISTORY_DAYS = HISTORY_DAYS + 30;

const round2 = (n: number) => Math.round(n * 100) / 100;

export function generateDataset(today: string): Dataset {
  const rnd = mulberry32(SEED);
  const between = (min: number, max: number) => min + rnd() * (max - min);
  const int = (min: number, max: number) => Math.floor(between(min, max + 1));
  const pick = <T,>(list: readonly T[]): T => list[Math.floor(rnd() * list.length)];
  const weightedIndex = (weights: number[]): number => {
    const total = weights.reduce((s, w) => s + w, 0);
    let r = rnd() * total;
    for (let i = 0; i < weights.length; i++) {
      r -= weights[i];
      if (r <= 0) return i;
    }
    return weights.length - 1;
  };

  // --- Курсы НБРК: в выходные курс не публикуется, действует пятничный ---
  const rates: Record<string, number> = {};
  let rate = KZT_PER_USD_START;
  for (let i = RATE_HISTORY_DAYS; i >= 0; i--) {
    const date = addDays(today, -i);
    const dow = weekday(date);
    const isWeekend = dow === 0 || dow === 6;
    if (!isWeekend) {
      rate = Math.min(524, Math.max(498, rate + between(-1.4, 1.5)));
      rates[date] = round2(rate);
    }
  }

  // --- Структура: кампании → группы → объявления → креативы ---
  const campaigns: Campaign[] = [];
  const adsets: AdSet[] = [];
  const ads: Ad[] = [];
  const creatives: Creative[] = [];
  const adMeta = new Map<string, { archetype: Archetype; source: LeadSource; startAgo: number; endAgo: number }>();
  const patternCounters = new Map<string, number>();
  const historyStart = addDays(today, -(HISTORY_DAYS - 1));

  for (const tpl of CAMPAIGNS) {
    const account = ACCOUNTS.find((a) => a.id === tpl.accountId)!;
    campaigns.push({
      id: tpl.id,
      accountId: tpl.accountId,
      platform: account.platform,
      name: tpl.name,
      objective: tpl.objective,
      status: tpl.status,
      dailyBudget: tpl.dailyBudget,
    });
    tpl.adsets.forEach((asTpl, asIndex) => {
      const adsetId = `${tpl.id}_s${asIndex + 1}`;
      adsets.push({ id: adsetId, campaignId: tpl.id, name: asTpl.name, status: tpl.status });
      asTpl.ads.forEach((archetype, adIndex) => {
        const pattern = pick(account.platform === "tiktok" ? TIKTOK_PATTERNS : CREATIVE_PATTERNS);
        const n = (patternCounters.get(pattern.name) ?? 0) + 1;
        patternCounters.set(pattern.name, n);
        const adId = `${adsetId}_a${adIndex + 1}`;
        const creativeId = `cr_${adId}`;
        const profile = PROFILES[archetype];
        const startAgo = int(profile.startAgo[0], profile.startAgo[1]);
        const paused = tpl.status === "paused";
        const endAgo = paused ? Math.min(PAUSED_CAMPAIGN_ENDED_AGO, startAgo - 1) : 0;
        creatives.push({
          id: creativeId,
          name: `${pattern.name}_${n}`,
          type: pattern.type,
          title: pattern.title,
          body: pattern.body,
          cta: pattern.cta,
          hue: int(0, 359),
          durationSec: pattern.type === "video" ? int(12, 34) : null,
        });
        ads.push({
          id: adId,
          adsetId,
          campaignId: tpl.id,
          accountId: tpl.accountId,
          platform: account.platform,
          name: `${pattern.name}_${n}`,
          status: paused ? "paused" : archetype === "burner" && rnd() < 0.4 ? "paused" : "active",
          creativeId,
          startDate: addDays(today, -startAgo) < historyStart ? historyStart : addDays(today, -startAgo),
          endDate: paused ? addDays(today, -endAgo) : null,
        });
        adMeta.set(adId, { archetype, source: tpl.source, startAgo, endAgo });
      });
    });
  }

  // Веса дней внутри жизни объявления: выгорающие — лиды в начале, растущие — в конце.
  const dayTrend = (archetype: Archetype, progress: number): number => {
    if (archetype === "fatigue") return 1.7 - 1.45 * progress;
    if (archetype === "growing") return 0.45 + 1.5 * progress;
    return 1;
  };
  const activeDays = (adId: string) => {
    const m = adMeta.get(adId)!;
    return m.startAgo - m.endAgo + 1;
  };

  // --- Лиды: раздаём по объявлениям пропорционально «силе» ---
  const paidLeadsTotal = TOTAL_LEADS - LEADS_WITHOUT_AD;
  const leadWeights = ads.map((ad) => {
    const m = adMeta.get(ad.id)!;
    return PROFILES[m.archetype].leadWeight * Math.sqrt(activeDays(ad.id) / HISTORY_DAYS) * between(0.85, 1.15);
  });
  const weightSum = leadWeights.reduce((s, w) => s + w, 0);
  const exact = leadWeights.map((w) => (w / weightSum) * paidLeadsTotal);
  const leadCounts = exact.map(Math.floor);
  let remainder = paidLeadsTotal - leadCounts.reduce((s, n) => s + n, 0);
  const byFraction = exact.map((v, i) => ({ i, frac: v - Math.floor(v) })).sort((a, b) => b.frac - a.frac);
  for (let k = 0; remainder > 0; k++, remainder--) leadCounts[byFraction[k % byFraction.length].i]++;

  const usedPhones = new Set<string>();
  const newPhone = (): string => {
    for (;;) {
      const phone = `+7${pick(MOBILE_PREFIXES)}${String(int(0, 9_999_999)).padStart(7, "0")}`;
      if (!usedPhones.has(phone)) {
        usedPhones.add(phone);
        return phone;
      }
    }
  };
  const newName = () => `${pick(FIRST_NAMES)} ${pick(LAST_INITIALS)}.`;
  const newTime = () => `${String(int(8, 22)).padStart(2, "0")}:${String(int(0, 59)).padStart(2, "0")}`;

  const leads: Lead[] = [];
  let leadSeq = 0;
  ads.forEach((ad, adIndex) => {
    const m = adMeta.get(ad.id)!;
    const days = activeDays(ad.id);
    const weights = Array.from({ length: days }, (_, d) => dayTrend(m.archetype, days > 1 ? d / (days - 1) : 1));
    for (let k = 0; k < leadCounts[adIndex]; k++) {
      const dayIndex = weightedIndex(weights);
      const isManual = rnd() < 0.03;
      leads.push({
        id: `l${++leadSeq}`,
        phone: newPhone(),
        name: newName(),
        source: isManual ? "manual" : m.source,
        platform: ad.platform,
        campaignId: ad.campaignId,
        adsetId: ad.adsetId,
        adId: ad.id,
        date: addDays(today, -(m.startAgo - dayIndex)),
        time: newTime(),
      });
    }
  });

  // Повторные касания: тот же номер приходит ещё раз с другого объявления.
  const earlyLeads = leads.filter((l) => diffDays(today, l.date) > 25);
  for (let k = 0; k < DUPLICATE_PHONE_LEADS; k++) {
    const original = pick(earlyLeads);
    const target = leads[int(0, leads.length - 1)];
    if (target.adId === original.adId || target.date <= original.date) continue;
    usedPhones.delete(target.phone);
    target.phone = original.phone;
    target.name = original.name;
  }

  for (let k = 0; k < LEADS_WITHOUT_AD; k++) {
    leads.push({
      id: `l${++leadSeq}`,
      phone: newPhone(),
      name: newName(),
      source: "manual",
      platform: null,
      campaignId: null,
      adsetId: null,
      adId: null,
      date: addDays(today, -int(0, HISTORY_DAYS - 1)),
      time: newTime(),
    });
  }
  leads.sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time));

  // --- Продажи ---
  const sales: Sale[] = [];
  let saleSeq = 0;
  const INPUTS: SaleInput[] = ["manual", "amocrm", "csv", "sheets"];
  const INPUT_WEIGHTS = [60, 20, 12, 8];
  const COMMENTS = ["", "", "", "Доставка курьером", "Самовывоз", "Подарочная упаковка", "Постоянный клиент", "Оплата Kaspi"];

  const makeSale = (phone: string, customerName: string, date: string, manualAdId: string | null = null): Sale => {
    const hasProduct = rnd() > 0.12;
    const product = hasProduct ? PRODUCTS[weightedIndex(PRODUCT_WEIGHTS)] : null;
    const qty = product && rnd() < 0.16 ? 2 : 1;
    const amount = product ? product.price * qty : int(15, 70) * 1000;
    const cost = product
      ? Math.round((product.costType === "amount" ? product.cost : (product.price * product.cost) / 100) * qty)
      : Math.round(amount * (1 - DEFAULT_MARGIN_PCT / 100));
    const input = INPUTS[weightedIndex(INPUT_WEIGHTS)];
    return {
      id: `s${++saleSeq}`,
      phone,
      customerName,
      amount,
      currency: "KZT",
      productId: product?.id ?? null,
      cost,
      date,
      comment: pick(COMMENTS),
      input,
      manualAdId,
      createdBy: input === "manual" ? pick(SALES_MANAGERS) : "—",
    };
  };

  const adLeads = leads.filter((l) => l.adId);
  const buyerWeights = adLeads.map((l) => PROFILES[adMeta.get(l.adId!)!.archetype].conv * between(0.6, 1.4));
  const buyers: Lead[] = [];
  const buyerPhones = new Set<string>();
  while (buyers.length < ATTRIBUTED_SALES - REPEAT_SALES) {
    const i = weightedIndex(buyerWeights);
    const lead = adLeads[i];
    buyerWeights[i] = 0;
    if (buyerPhones.has(lead.phone)) continue;
    buyerPhones.add(lead.phone);
    buyers.push(lead);
  }
  for (const lead of buyers) {
    const date = addDays(lead.date, int(0, 9));
    sales.push(makeSale(lead.phone, lead.name, date > today ? today : date));
  }
  // Повторные покупки тех же клиентов
  const repeatCandidates = buyers.filter((l) => diffDays(today, l.date) > 30);
  for (let k = 0; k < REPEAT_SALES; k++) {
    const lead = repeatCandidates[int(0, repeatCandidates.length - 1)];
    const date = addDays(lead.date, int(14, 26));
    sales.push(makeSale(lead.phone, lead.name, date > today ? today : date));
  }
  // Продажи без источника: номера нет среди лидов. Части менеджер указал источник вручную.
  const activeAdIds = ads.filter((a) => adMeta.get(a.id)!.archetype !== "burner").map((a) => a.id);
  for (let k = 0; k < UNATTRIBUTED_SALES; k++) {
    const manualAdId = k < UNATTRIBUTED_WITH_MANUAL_SOURCE ? pick(activeAdIds) : null;
    sales.push(makeSale(newPhone(), newName(), addDays(today, -int(0, 55)), manualAdId));
  }
  // Один явный дубль (CRM + ручной ввод), чтобы было видно предупреждение.
  const original = sales[3];
  const duplicate = sales[sales.length - 1];
  duplicate.phone = original.phone;
  duplicate.customerName = original.customerName;
  duplicate.amount = original.amount;
  duplicate.productId = original.productId;
  duplicate.cost = original.cost;
  duplicate.date = addDays(original.date, 1) > today ? original.date : addDays(original.date, 1);
  duplicate.input = "amocrm";
  duplicate.createdBy = "—";
  duplicate.manualAdId = null;
  original.input = "manual";
  original.createdBy = SALES_MANAGERS[0];

  sales.sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));

  // --- Статистика «объявление × день» ---
  const insights: InsightDaily[] = [];
  const salesByAdDay = new Map<string, { count: number; amountKzt: number }>();
  const leadByPhone = new Map<string, Lead>();
  for (const l of [...leads].reverse()) leadByPhone.set(l.phone, l);
  for (const s of sales) {
    const lead = leadByPhone.get(s.phone);
    if (!lead?.adId) continue;
    const key = `${lead.adId}|${s.date}`;
    const entry = salesByAdDay.get(key) ?? { count: 0, amountKzt: 0 };
    entry.count++;
    entry.amountKzt += s.amount;
    salesByAdDay.set(key, entry);
  }

  ads.forEach((ad, adIndex) => {
    const m = adMeta.get(ad.id)!;
    const profile = PROFILES[m.archetype];
    const account = ACCOUNTS.find((a) => a.id === ad.accountId)!;
    const creative = creatives.find((c) => c.id === ad.creativeId)!;
    const days = activeDays(ad.id);
    const baseCpl = BASE_CPL[ad.platform];
    const totalSpend = Math.max(leadCounts[adIndex], 1) * baseCpl * profile.cplMult * between(0.9, 1.12);
    const spendWeights = Array.from({ length: days }, (_, d) => {
      const progress = days > 1 ? d / (days - 1) : 1;
      const ramp = m.archetype === "growing" ? 0.5 + 1.3 * progress : 1;
      return ramp * between(0.7, 1.3);
    });
    const spendWeightSum = spendWeights.reduce((s, w) => s + w, 0);
    const isWebsite = m.source === "website";
    const avgWatch = between(4, 11);
    const holdRate = between(0.12, 0.32);

    for (let d = 0; d < days; d++) {
      const progress = days > 1 ? d / (days - 1) : 1;
      const date = addDays(today, -(m.startAgo - d));
      const spend = (totalSpend * spendWeights[d]) / spendWeightSum;
      const [cpmMin, cpmMax] = BASE_CPM[ad.platform];
      const impressions = Math.round((spend / between(cpmMin, cpmMax)) * 1000);
      const ctrTrend = m.archetype === "fatigue" ? 1.15 - 0.85 * progress : m.archetype === "growing" ? 0.9 + 0.25 * progress : 1;
      const clicks = Math.round(impressions * profile.ctr * ctrTrend * between(0.85, 1.15));
      const frequency = m.archetype === "fatigue" ? 1.2 + 3.1 * progress : between(1.08, 1.6);
      const isVideo = creative.type === "video";
      const video3s = isVideo ? Math.round(impressions * profile.hook * between(0.88, 1.12)) : 0;
      const videoPlays = isVideo ? Math.round(impressions * 0.92) : 0;
      const sold = salesByAdDay.get(`${ad.id}|${date}`);
      const pixelPurchases = isWebsite && sold ? Math.max(0, sold.count + (rnd() < 0.3 ? -1 : rnd() < 0.2 ? 1 : 0)) : 0;
      const pixelValueKzt = isWebsite && sold && pixelPurchases ? (sold.amountKzt / sold.count) * pixelPurchases * between(0.85, 1.1) : 0;
      const fx = rateOn(rates, date).rate;
      // Кабинет насчитывает лидов больше, чем доходит до LightLeads: дубли и заявки без номера
      const adLeads = Math.round(((leadCounts[adIndex] * spendWeights[d]) / spendWeightSum) * AD_LEADS_OVERCOUNT);
      const byMessage = m.source === "whatsapp" || m.source === "instagram";
      insights.push({
        adId: ad.id,
        date,
        currency: account.currency,
        spend: account.currency === "USD" ? round2(spend) : Math.round(spend),
        impressions,
        reach: Math.round(impressions / frequency),
        clicks,
        pixelPurchases,
        pixelValue: account.currency === "USD" ? round2(pixelValueKzt / fx) : Math.round(pixelValueKzt),
        platformLeads: byMessage ? 0 : adLeads,
        messagingStarted: byMessage ? adLeads : 0,
        videoPlays,
        video3s,
        videoHold: Math.round(video3s * holdRate * between(0.9, 1.1)),
        videoWatchSec: Math.round(videoPlays * avgWatch),
      });
    }
  });

  // --- Журнал синхронизаций ---
  const syncRuns: SyncRun[] = [];
  ACCOUNTS.forEach((account, i) => {
    for (let k = 0; k < 4; k++) {
      const failed = account.platform === "tiktok" && k === 2;
      syncRuns.push({
        id: `sync_${account.id}_${k}`,
        accountId: account.id,
        status: failed ? "error" : "success",
        startedAt: `${addDays(today, k === 3 ? -1 : 0)} ${String(Math.max(0, 14 - k * 2)).padStart(2, "0")}:${i === 0 ? "05" : "07"}`,
        durationSec: int(18, 74),
        rows: failed ? 0 : int(90, 140),
        error: failed ? "Rate limit: повтор через 60 с" : null,
      });
    }
  });

  return {
    today,
    accounts: ACCOUNTS,
    campaigns,
    adsets,
    ads,
    creatives,
    insights,
    leads,
    products: PRODUCTS,
    sales,
    rates,
    members: MEMBERS,
    syncRuns,
  };
}
