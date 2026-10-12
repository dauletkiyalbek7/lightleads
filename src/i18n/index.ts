import { ru } from "./ru";

/**
 * Все тексты интерфейса лежат в словаре. Чтобы добавить казахский или английский,
 * создайте kk.ts / en.ts с тем же типом Dictionary и переключайте язык здесь.
 */
export type Dictionary = typeof ru;
export const t: Dictionary = ru;

/** Русские формы множественного числа: plural(5, ["день", "дня", "дней"]) → «дней» */
export function plural(n: number, forms: readonly [string, string, string]): string {
  const abs = Math.abs(n) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return forms[2];
  if (last > 1 && last < 5) return forms[1];
  if (last === 1) return forms[0];
  return forms[2];
}
