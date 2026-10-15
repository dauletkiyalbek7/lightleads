/** Название продукта и глобальные константы. Название меняется в одном месте. */
export const APP = {
  name: "LightLeads",
  defaultCountry: "KZ",
  timezone: "Asia/Almaty",
  demoMode: true,
} as const;

/**
 * Кто отвечает за данные: показывается в политике конфиденциальности и на странице удаления данных.
 * Пока поля пустые, страницы показывают пометку, что контакты ещё не указаны: с ней на проверку Meta не подавать.
 */
export const LEGAL = {
  /** Название ИП или ТОО. */
  operator: "",
  /** Почта для вопросов о данных и запросов на удаление. */
  email: "",
  /** Дата текущей редакции политики, YYYY-MM-DD. */
  updatedOn: "2026-10-15",
} as const;

export const HISTORY_DAYS = 90;
export const ATTRIBUTION_WINDOWS = [7, 14, 30, 60, 90] as const;
/** Ключ дубля продажи: телефон + сумма + дата ± N дней. */
export const DUPLICATE_DAY_TOLERANCE = 1;
