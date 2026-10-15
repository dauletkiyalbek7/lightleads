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

/**
 * Скрипт Google Apps Script для таблицы с заявками. Раз в минуту отправляет новые строки в LightLeads
 * как источник «Google-таблица» и отмечает отправленные в колонке «LightLeads».
 * Строки, которые были в таблице до запуска, не отправляет, пока не вызвать sendOldRows.
 */
export const sheetsScript = (origin: string, key: string) => `// LightLeads: отправляет новые строки этой таблицы в LightLeads.
// Как запустить: выберите вверху функцию «start» и нажмите «Выполнить».
const LIGHTLEADS_URL = "${origin}${INGEST_PATH}";
const LIGHTLEADS_KEY = "${key}";
const SHEET_NAME = ""; // пусто — первый лист таблицы
const STATUS_HEADER = "LightLeads";
const OLD_ROW = "было до подключения";
const BATCH = 40; // строк за один запуск

function start() {
  stop();
  const sheet = leadsSheet_();
  const statusCol = statusColumn_(sheet);
  const last = sheet.getLastRow();
  // Строки, которые уже есть в таблице, не отправляем: только новые
  if (last > 1) {
    const range = sheet.getRange(2, statusCol, last - 1, 1);
    range.setValues(range.getValues().map((row) => [String(row[0]).trim() ? row[0] : OLD_ROW]));
  }
  ScriptApp.newTrigger("sendNewLeads").timeBased().everyMinutes(1).create();
}

function stop() {
  ScriptApp.getProjectTriggers().filter((t) => t.getHandlerFunction() === "sendNewLeads").forEach((t) => ScriptApp.deleteTrigger(t));
}

// Отправить и старые строки: дата заявки берётся из колонки «Дата»
function sendOldRows() {
  const sheet = leadsSheet_();
  const statusCol = statusColumn_(sheet);
  const last = sheet.getLastRow();
  if (last < 2) return;
  const range = sheet.getRange(2, statusCol, last - 1, 1);
  range.setValues(range.getValues().map((row) => [row[0] === OLD_ROW ? "" : row[0]]));
  sendNewLeads();
}

function sendNewLeads() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return;
  try {
    const sheet = leadsSheet_();
    const statusCol = statusColumn_(sheet);
    const values = sheet.getDataRange().getValues();
    const headers = values[0].map((h) => String(h).trim());
    const send = [];
    for (let r = 1; r < values.length && send.length < BATCH; r++) {
      const row = values[r];
      if (String(row[statusCol - 1] ?? "").trim()) continue;
      const lead = {};
      headers.forEach((h, c) => {
        if (!h || c === statusCol - 1 || row[c] === "") return;
        lead[h] = row[c] instanceof Date ? row[c].toISOString() : String(row[c]);
      });
      // Пустые строки пропускаем
      if (Object.keys(lead).length) send.push({ rowNumber: r + 1, lead });
    }
    if (!send.length) return;

    const responses = UrlFetchApp.fetchAll(send.map((item) => ({
      url: LIGHTLEADS_URL,
      method: "post",
      contentType: "application/json",
      headers: { "x-workspace-key": LIGHTLEADS_KEY, "x-lead-source": "sheet" },
      payload: JSON.stringify(item.lead),
      muteHttpExceptions: true,
    })));
    const time = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "dd.MM HH:mm");
    responses.forEach((response, i) => {
      const code = response.getResponseCode();
      // 429 — слишком много за минуту: строка уйдёт при следующем запуске
      const mark = code < 300 ? "отправлено " + time : code === 422 ? "нет телефона" : code === 429 ? "" : "ошибка " + code;
      if (mark) sheet.getRange(send[i].rowNumber, statusCol).setValue(mark);
    });
  } finally {
    lock.releaseLock();
  }
}

function leadsSheet_() {
  const book = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = SHEET_NAME ? book.getSheetByName(SHEET_NAME) : book.getSheets()[0];
  if (!sheet) throw new Error("Нет листа с названием " + SHEET_NAME);
  return sheet;
}

function statusColumn_(sheet) {
  const width = Math.max(sheet.getLastColumn(), 1);
  const headers = sheet.getRange(1, 1, 1, width).getValues()[0].map((h) => String(h).trim());
  const found = headers.indexOf(STATUS_HEADER);
  if (found >= 0) return found + 1;
  const col = headers.some((h) => h) ? width + 1 : 1;
  sheet.getRange(1, col).setValue(STATUS_HEADER);
  return col;
}
`;
