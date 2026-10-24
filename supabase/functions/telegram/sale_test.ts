import { assert, assertEquals } from "jsr:@std/assert@1";
import { DEMO_LEAD, leadMessage, testMessage, chatMessage, type LeadNotice } from "./message.ts";
import { formatAmount, matchProduct, parseCallback, parseSale, type ProductRow, saleCost, salePrompt, saleSavedMessage, todayIn } from "./sale.ts";

Deno.test("parseSale: сумма, валюта и товар в разных записях", () => {
  assertEquals(parseSale("45000 английский"), { amount: 45000, currency: null, product: "английский" });
  assertEquals(parseSale("45 000 английский язык"), { amount: 45000, currency: null, product: "английский язык" });
  assertEquals(parseSale("45.000 тг курс"), { amount: 45000, currency: "KZT", product: "курс" });
  assertEquals(parseSale("45к — математика"), { amount: 45000, currency: null, product: "математика" });
  assertEquals(parseSale("$300 курс"), { amount: 300, currency: "USD", product: "курс" });
  assertEquals(parseSale("300$"), { amount: 300, currency: "USD", product: "" });
  assertEquals(parseSale("12,5 usd пробный"), { amount: 12.5, currency: "USD", product: "пробный" });
  assertEquals(parseSale("  90000 ₸"), { amount: 90000, currency: "KZT", product: "" });
  assertEquals(parseSale("150 000 тенге, 3 месяца"), { amount: 150000, currency: "KZT", product: "3 месяца" });
});

Deno.test("parseSale: без суммы — не продажа", () => {
  assertEquals(parseSale("английский"), null);
  assertEquals(parseSale("0 курс"), null);
  assertEquals(parseSale(""), null);
  assertEquals(parseSale("45000английский"), null);
});

const product = (name: string, extra: Partial<ProductRow> = {}): ProductRow => ({ id: name, name, price: 50000, cost_type: "amount", cost: 10000, ...extra });

Deno.test("matchProduct: самое длинное подходящее название", () => {
  const list = [product("Английский"), product("Английский интенсив"), product("Математика")];
  assertEquals(matchProduct("английский интенсив 3 мес", list)?.name, "Английский интенсив");
  assertEquals(matchProduct("английский", list)?.name, "Английский интенсив");
  assertEquals(matchProduct("матем", list)?.name, "Математика");
  assertEquals(matchProduct("пробный", list), null);
  assertEquals(matchProduct("", list), null);
});

Deno.test("saleCost: из товара или по марже", () => {
  assertEquals(saleCost(45000, product("A"), 55), 10000);
  assertEquals(saleCost(45000, product("A", { cost_type: "percent", cost: 30 }), 55), 15000);
  assertEquals(saleCost(40000, null, 55), 18000);
});

Deno.test("parseCallback", () => {
  assertEquals(parseCallback("sale:abc"), { kind: "sale", id: "abc" });
  assertEquals(parseCallback("unsale:xyz"), { kind: "undo", id: "xyz" });
  assertEquals(parseCallback("other"), null);
});

Deno.test("todayIn и formatAmount", () => {
  assertEquals(todayIn("Asia/Almaty", new Date("2026-10-24T20:30:00Z")), "2026-10-25");
  assertEquals(formatAmount(45000, "KZT"), "45 000 ₸");
  assertEquals(formatAmount(300.5, "USD"), "$300,5");
});

const lead: LeadNotice = { project: "Проект", name: "Айгерим", phone: "+77011234567", source: "website", createdAt: "2026-10-24T07:00:00Z", adName: null, campaignName: null, message: null };

Deno.test("кнопка «Продажа» под заявкой — первой, только если заявка есть в базе", () => {
  const withLead = leadMessage(lead, "https://app", false, "lead-1");
  assertEquals(withLead.buttons[0], { text: "✅ Продажа", callback_data: "sale:lead-1" });
  assert(!leadMessage(lead, "https://app").buttons.some((b) => "callback_data" in b));
  assertEquals(chatMessage("П", "А", "+77011234567", "ещё вопрос", "lead-2").buttons, [{ text: "✅ Продажа", callback_data: "sale:lead-2" }]);
  assertEquals(chatMessage("П", "А", "+77011234567", "ещё вопрос").buttons, []);
  assert(testMessage("П", "https://app").buttons.some((b) => "callback_data" in b && b.callback_data === `sale:${DEMO_LEAD}`));
});

Deno.test("вопрос о сумме просит ответить, подтверждение даёт отменить", () => {
  const prompt = salePrompt("Айгерим <script>", "+77011234567");
  assert(prompt.forceReply);
  assert(prompt.text.includes("&lt;script&gt;"));
  const saved = saleSavedMessage({ id: "s1", name: "Айгерим", amount: 45000, currency: "KZT", product: "Английский", seller: "Даулет" });
  assert(saved.text.includes("45 000 ₸") && saved.text.includes("Продавец: Даулет"));
  assertEquals(saved.buttons, [{ text: "Отменить", callback_data: "unsale:s1" }]);
});
