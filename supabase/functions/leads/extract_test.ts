// Запуск: deno test supabase/functions/leads/extract_test.ts
import { assertEquals } from "jsr:@std/assert@1";
import { extractLead, isProbe, normalizePhone, parseBody } from "./extract.ts";

Deno.test("телефон приводится к E.164 для Казахстана", () => {
  assertEquals(normalizePhone("8 701 123 45 67", "KZ"), "+77011234567");
  assertEquals(normalizePhone("+7 (701) 123-45-67", "KZ"), "+77011234567");
  assertEquals(normalizePhone("7011234567", "KZ"), "+77011234567");
  assertEquals(normalizePhone("87011234567", "KZ"), "+77011234567");
});

Deno.test("иностранный номер с плюсом сохраняет свою страну", () => {
  assertEquals(normalizePhone("+998 90 123 45 67", "KZ"), "+998901234567");
});

Deno.test("мусор вместо телефона отклоняется", () => {
  assertEquals(normalizePhone("123", "KZ"), null);
  assertEquals(normalizePhone("позвоните мне", "KZ"), null);
  assertEquals(normalizePhone("8 701 123", "KZ"), null);
});

Deno.test("JSON с сайта: телефон, имя и метки", () => {
  const lead = extractLead({ phone: "8 701 123 45 67", name: "Айгерим", utm_source: "facebook", utm_content: "120210000000000" }, "KZ");
  assertEquals(lead, { phone: "+77011234567", name: "Айгерим", utm: { utm_source: "facebook", utm_content: "120210000000000" }, externalId: null });
});

Deno.test("форма Tilda: поля с заглавной буквы и номер заявки", () => {
  const body = parseBody("Name=%D0%90%D0%BB%D0%B8&Phone=%2B7+%28701%29+123-45-67&tranid=1234%3A5678&formid=form1&formname=Zayavka&utm_source=tiktok&utm_content=1878207674887233", "application/x-www-form-urlencoded");
  const lead = extractLead(body, "KZ");
  assertEquals(lead.phone, "+77011234567");
  assertEquals(lead.name, "Али");
  assertEquals(lead.externalId, "1234:5678");
  assertEquals(lead.utm, { utm_source: "tiktok", utm_content: "1878207674887233" });
});

Deno.test("вебхук квиза: вложенные контакты и метки", () => {
  const lead = extractLead(
    { answers: [{ q: "Возраст", a: "25" }], contacts: { name: "Дана", phone: "87771234567" }, extra: { utm: { source: "tiktok", campaign: "1877657007789521", content: "1877657091027985" } } },
    "KZ",
  );
  assertEquals(lead.phone, "+77771234567");
  assertEquals(lead.name, "Дана");
  assertEquals(lead.utm, { utm_source: "tiktok", utm_campaign: "1877657007789521", utm_content: "1877657091027985" });
});

Deno.test("поле с нестандартным названием находится по вхождению", () => {
  assertEquals(extractLead({ "Телефон для связи": "8 701 123 45 67" }, "KZ").phone, "+77011234567");
  assertEquals(extractLead({ "your-phone": "8 701 123 45 67", formname: "Заявка" }, "KZ").name, "");
});

Deno.test("неподставленный макрос платформы в метки не попадает", () => {
  const lead = extractLead({ phone: "87011234567", utm_content: "{{ad.id}}", utm_term: "__AID__", utm_campaign: "120210000000001" }, "KZ");
  assertEquals(lead.utm, { utm_campaign: "120210000000001" });
});

Deno.test("проверочный запрос Tilda распознаётся", () => {
  assertEquals(isProbe(parseBody("test=test", "application/x-www-form-urlencoded")), true);
  assertEquals(isProbe({ test: "test", phone: "87011234567" }), false);
});

Deno.test("JSON, присланный как text/plain, разбирается", () => {
  assertEquals(parseBody('{"phone":"87011234567"}', "text/plain;charset=UTF-8"), { phone: "87011234567" });
});
