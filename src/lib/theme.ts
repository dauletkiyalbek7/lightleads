/** Цветовые темы. Сами цвета — в globals.css под :root[data-theme="..."]. */
export const THEMES = ["lime", "violet"] as const;
export type Theme = (typeof THEMES)[number];

export const DEFAULT_THEME: Theme = "lime";
export const THEME_STORAGE_KEY = "ll-theme";

/** Образец цвета для переключателя (градиент --brand-fill → --brand-fill-2 каждой темы). */
export const THEME_SWATCH: Record<Theme, string> = {
  lime: "linear-gradient(135deg, #a3e635, #84cc16)",
  violet: "linear-gradient(135deg, #6d5bff, #3d8bff)",
};

export const isTheme = (value: unknown): value is Theme => THEMES.includes(value as Theme);

/**
 * Скрипт выполняется до первой отрисовки (вставлен в <head>), чтобы страница
 * не мигала темой по умолчанию. Тема lime — это :root без атрибута.
 */
export const themeInitScript = `(function(){try{var t=localStorage.getItem("${THEME_STORAGE_KEY}");if(${JSON.stringify(THEMES)}.indexOf(t)>0)document.documentElement.dataset.theme=t;}catch(e){}})();`;
