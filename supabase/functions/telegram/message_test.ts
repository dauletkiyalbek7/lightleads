import { assert, assertEquals } from "jsr:@std/assert@1";
import { chatMessage, escapeHtml, formatTime, leadMessage, REPLY_HINT, type LeadNotice, parseStart, sameText, SUMMARY_LINES, summaryMessage, webhookSecret, whatsappLink } from "./message.ts";

const APP = "https://app.example";
const lead = (extra: Partial<LeadNotice> = {}): LeadNotice => ({
  project: "Bilim <школа>",
  name: "Айгерим",
  phone: "+77011234567",
  source: "whatsapp",
  createdAt: "2026-10-15T09:32:00Z",
  adName: "Скидка 20%",
  campaignName: "Осень",
  message: "Сколько стоит?",
  ...extra,
});

Deno.test("команда /start: с кодом, с именем бота, без кода и чужая", () => {
  assertEquals(parseStart("/start abc_DEF-123"), "abc_DEF-123");
  assertEquals(parseStart("/start@LightLeadsBot abc"), "abc");
  assertEquals(parseStart("/start"), "");
  assertEquals(parseStart("  /start  "), "");
  assertEquals(parseStart("/stop abc"), null);
  assertEquals(parseStart("привет"), null);
  assertEquals(parseStart("/start a b"), null);
  assertEquals(parseStart("/start <script>"), null);
});

Deno.test("заявка: имя, телефон, сообщение, объявление и кнопки", () => {
  const { text, buttons } = leadMessage(lead(), APP);
  assert(text.includes("Bilim &lt;школа&gt;"));
  assert(text.includes("<b>Айгерим</b>"));
  assert(text.includes("+7 701 123 4567"));
  assert(text.includes("«Сколько стоит?»"));
  assert(text.includes("Источник: WhatsApp"));
  assert(text.includes("Объявление: Скидка 20%"));
  assert(text.includes("Кампания: Осень"));
  assert(text.includes("Время: 15.10, 14:32"));
  assertEquals(buttons, [
    { text: "Написать в WhatsApp", url: "https://wa.me/77011234567" },
    { text: "Открыть в LightLeads", url: `${APP}/leads` },
  ]);
});

Deno.test("заявка без имени, сообщения и объявления; HTML из формы экранируется", () => {
  const { text } = leadMessage(lead({ name: "", message: null, adName: null, campaignName: null, source: "sheet" }), APP);
  assert(text.includes("<b>Без имени</b>"));
  assert(!text.includes("💬"));
  assert(!text.includes("Объявление:"));
  assert(text.includes("Источник: Google-таблица"));
  assert(leadMessage(lead({ name: "<b>x</b>" }), APP).text.includes("&lt;b&gt;x&lt;/b&gt;"));
});

Deno.test("сводка: перечисляет первые заявки и число остальных", () => {
  const many = Array.from({ length: SUMMARY_LINES + 3 }, (_, i) => lead({ name: `Клиент ${i}` }));
  const { text, buttons } = summaryMessage("Проект", many, APP);
  assert(text.includes(`Новых заявок: ${SUMMARY_LINES + 3}`));
  assert(text.includes("Клиент 0"));
  assert(!text.includes(`Клиент ${SUMMARY_LINES}`));
  assert(text.includes("и ещё 3"));
  assertEquals(buttons.length, 1);
});

Deno.test("вспомогательные: экранирование, ссылка WhatsApp, время, секрет вебхука", async () => {
  assertEquals(escapeHtml("a & <b>"), "a &amp; &lt;b&gt;");
  assertEquals(whatsappLink("+7 (701) 123-45-67"), "https://wa.me/77011234567");
  assertEquals(formatTime("2026-01-02T19:05:00Z"), "03.01, 00:05");
  const secret = await webhookSecret("123:token");
  assertEquals(secret, await webhookSecret("123:token"));
  assertEquals(secret.length, 64);
  assert(/^[0-9a-f]+$/.test(secret));
  assert(secret !== (await webhookSecret("123:other")));
  assert(sameText("abc", "abc"));
  assert(!sameText("abc", "abd"));
  assert(!sameText("abc", "ab"));
});

Deno.test("заявка с номера WhatsApp Cloud API: подсказка ответа вместо кнопки WhatsApp", () => {
  const { text, buttons } = leadMessage(lead(), APP, true);
  assert(text.endsWith(REPLY_HINT));
  assertEquals(buttons, [{ text: "Открыть в LightLeads", url: `${APP}/leads` }]);
});

Deno.test("сообщение из переписки: кто написал и текст без HTML", () => {
  const { text, buttons } = chatMessage("Bilim", "Дана", "+77011234567", "Цена <b>?</b>");
  assertEquals(text, "💬 <b>Дана</b> · +7 701 123 4567 · Bilim\nЦена &lt;b&gt;?&lt;/b&gt;");
  assertEquals(buttons, []);
});

Deno.test("сообщение с файлом: текст становится подписью и укладывается в предел Telegram", () => {
  const attachment = { kind: "photo" as const, file: "file-id" };
  const message = chatMessage("Bilim", "Дана", "+77011234567", "а".repeat(5000), "lead-1", attachment);
  assertEquals(message.attachment, attachment);
  assert(message.text.length < 1024);
  assertEquals(chatMessage("Bilim", "Дана", "+77011234567", "а".repeat(5000)).attachment, undefined);
});

Deno.test("ответ менеджера файлом: тип сообщения WhatsApp по виду и размеру", async () => {
  const { managerMedia } = await import("./whatsapp.ts");
  const MB = 1024 * 1024;
  assertEquals(managerMedia({}), null);
  assertEquals(managerMedia({ photo: [{ file_id: "small", file_size: 100 }, { file_id: "big", file_size: 2 * MB }] }), { fileId: "big", type: "image", mimeType: "image/jpeg", filename: "photo.jpeg" });
  assertEquals(managerMedia({ voice: { file_id: "v", mime_type: "audio/ogg", file_size: 30_000 } }), { fileId: "v", type: "audio", mimeType: "audio/ogg", filename: "voice.ogg" });
  assertEquals(managerMedia({ video_note: { file_id: "n", file_size: MB } }), { fileId: "n", type: "video", mimeType: "video/mp4", filename: "video.mp4" });
  // Видео больше 16 МБ и аудио в неподходящем формате WhatsApp принимает только документом
  assertEquals(managerMedia({ video: { file_id: "x", mime_type: "video/mp4", file_size: 17 * MB } }), { fileId: "x", type: "document", mimeType: "video/mp4", filename: "video.mp4" });
  assertEquals(managerMedia({ audio: { file_id: "x", mime_type: "audio/flac", file_name: "song.flac" } }), { fileId: "x", type: "document", mimeType: "audio/flac", filename: "song.flac" });
  assertEquals(managerMedia({ document: { file_id: "d", mime_type: "application/pdf", file_name: "Счёт.pdf", file_size: 3 * MB } }), {
    fileId: "d",
    type: "document",
    mimeType: "application/pdf",
    filename: "Счёт.pdf",
  });
  assert("problem" in (managerMedia({ document: { file_id: "d", file_size: 21 * MB } }) ?? {}));
  assert("problem" in (managerMedia({ sticker: { file_id: "s" } }) ?? {}));
});

Deno.test("ошибки WhatsApp: известные коды понятным текстом, остальные — как ответила Meta", async () => {
  const { whatsappProblem } = await import("./whatsapp.ts");
  assert(whatsappProblem(131047, "Re-engagement message").includes("24 часов"));
  assert(whatsappProblem(190, "Session expired").includes("Переподключите Meta"));
  assertEquals(whatsappProblem(1, "Unknown"), "WhatsApp ответил: Unknown");
});
