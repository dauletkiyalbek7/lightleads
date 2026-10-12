/** Название продукта и глобальные константы. Название меняется в одном месте. */
export const APP = {
  name: "LightLeads",
  defaultCountry: "KZ",
  timezone: "Asia/Almaty",
  demoMode: true,
} as const;

export const HISTORY_DAYS = 90;
export const ATTRIBUTION_WINDOWS = [7, 14, 30, 60, 90] as const;
/** Ключ дубля продажи: телефон + сумма + дата ± N дней. */
export const DUPLICATE_DAY_TOLERANCE = 1;
