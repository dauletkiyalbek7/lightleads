/** Готовые строки URL-параметров для рекламных кабинетов. Макросы подставляет сама платформа. */
export const UTM_TEMPLATES = {
  meta: "utm_source=facebook&utm_medium=paid&utm_campaign={{campaign.id}}&utm_term={{adset.id}}&utm_content={{ad.id}}",
  tiktok: "utm_source=tiktok&utm_medium=paid&utm_campaign=__CAMPAIGN_ID__&utm_term=__AID__&utm_content=__CID__",
} as const;

export const INGEST_PATH = "/api/ingest/lead";
export const SNIPPET_PATH = "/ll.js";
/** Ключ для демо-режима: настоящий выдаётся каждому workspace в базе. */
export const DEMO_WORKSPACE_KEY = "ws_demo_3f9a1c7e52b84d0a";

/**
 * Одна строка для сайта клиента. Скрипт (public/ll.js) хранит UTM, fbclid и ttclid в cookie 30 дней,
 * подставляет их в скрытые поля форм и при отправке формы с телефоном передаёт лид в LightLeads.
 */
export const siteSnippet = (origin: string, key: string) => `<script src="${origin}${SNIPPET_PATH}" data-key="${key}" async></script>`;

/** Пример запроса для своего сервера, Tilda и других вебхуков. */
export const ingestExample = (origin: string, key: string) => `curl -X POST ${origin}${INGEST_PATH} \\
  -H "x-workspace-key: ${key}" \\
  -H "content-type: application/json" \\
  -d '{"phone": "8 701 123 45 67", "name": "Айгерим", "utm_source": "facebook", "utm_content": "120210000000000"}'`;

/** Адрес вебхука для конструкторов, где нельзя задать заголовок (Tilda, квизы): ключ передаётся в адресе. */
export const ingestUrlWithKey = (origin: string, key: string) => `${origin}${INGEST_PATH}?key=${key}`;
