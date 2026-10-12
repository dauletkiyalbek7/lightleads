/** Цветовые темы. Сами цвета — в globals.css под :root[data-theme="..."]. */
export const THEMES = ["violet", "green"] as const;
export type Theme = (typeof THEMES)[number];

export const DEFAULT_THEME: Theme = "violet";
export const THEME_STORAGE_KEY = "ll-theme";

/** Образец цвета для переключателя (градиент --brand → --brand-2 каждой темы). */
export const THEME_SWATCH: Record<Theme, string> = {
  violet: "linear-gradient(135deg, #6d5bff, #3d8bff)",
  green: "linear-gradient(135deg, #0a9a6a, #0e9f9a)",
};

export const isTheme = (value: unknown): value is Theme => THEMES.includes(value as Theme);

/**
 * Скрипт выполняется до первой отрисовки (вставлен в <head>), чтобы страница
 * не мигала темой по умолчанию. Тема violet — это :root без атрибута.
 */
export const themeInitScript = `(function(){try{var t=localStorage.getItem("${THEME_STORAGE_KEY}");if(${JSON.stringify(THEMES)}.indexOf(t)>0)document.documentElement.dataset.theme=t;}catch(e){}})();`;
