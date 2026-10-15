import { assert, assertEquals } from "jsr:@std/assert@1";
import { fieldsOf, parseSignedRequest, parseWebhook, verifySignature, verifyToken } from "./webhook.ts";

const SECRET = "test-app-secret";

async function sign(body: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return "sha256=" + Array.from(new Uint8Array(signature), (b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.test("подпись: верная принимается, чужая и пустая — нет", async () => {
  const body = JSON.stringify({ object: "page", entry: [] });
  assert(await verifySignature(SECRET, body, await sign(body)));
  assert(!(await verifySignature(SECRET, body + " ", await sign(body))));
  assert(!(await verifySignature("other-secret", body, await sign(body))));
  assert(!(await verifySignature(SECRET, body, null)));
  assert(!(await verifySignature(SECRET, body, "sha256=")));
  assert(!(await verifySignature("", body, await sign(body))));
});

Deno.test("проверочная строка: постоянная и не равна секрету", async () => {
  const token = await verifyToken(SECRET);
  assertEquals(token, await verifyToken(SECRET));
  assertEquals(token.length, 32);
  assert(!token.includes(SECRET));
});

Deno.test("лид-форма: уведомление с объявлением и проверочное без него", () => {
  const parsed = parseWebhook({
    object: "page",
    entry: [
      {
        id: "111",
        time: 1760000000,
        changes: [
          { field: "leadgen", value: { leadgen_id: "9001", page_id: "111", form_id: "501", adgroup_id: "301", ad_id: "120210000000001", created_time: 1760000000 } },
          { field: "leadgen", value: { leadgen_id: 9002, page_id: 111, form_id: 501, ad_id: 0 } },
          { field: "feed", value: { leadgen_id: "9003", page_id: "111" } },
          { field: "leadgen", value: { page_id: "111" } },
        ],
      },
    ],
  });
  assertEquals(parsed.messages, []);
  assertEquals(parsed.forms, [
    { leadId: "9001", pageId: "111", formId: "501", adId: "120210000000001" },
    { leadId: "9002", pageId: "111", formId: "501", adId: null },
  ]);
});

Deno.test("WhatsApp: каждое сообщение клиента, объявление — только у перехода с рекламы", () => {
  const message = (id: string, extra: Record<string, unknown>) => ({ from: "77011234567", id, timestamp: "1760000000", type: "text", text: { body: "Здравствуйте" }, ...extra });
  const parsed = parseWebhook({
    object: "whatsapp_business_account",
    entry: [
      {
        id: "WABA",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { display_phone_number: "77770000000", phone_number_id: "555" },
              contacts: [{ profile: { name: "Айгерим" }, wa_id: "77011234567" }],
              messages: [
                message("wamid.A", { referral: { source_type: "ad", source_id: "120210000000001", source_url: "https://fb.me/x", headline: "Скидка", ctwa_clid: "clid1", body: "текст" } }),
                message("wamid.B", {}),
                message("wamid.C", { referral: { source_type: "post", source_id: "777" } }),
                message("wamid.D", { type: "image", text: undefined, image: { id: "m1", caption: "вот такой" } }),
                message("wamid.E", { type: "audio", text: undefined, audio: { id: "m2" } }),
                message("wamid.F", { type: "reaction", text: undefined, reaction: { emoji: "👍" } }),
                message("wamid.G", { type: "button", text: undefined, button: { text: "Хочу записаться" } }),
              ],
            },
          },
          // Статусы доставки приходят тем же полем, но без сообщений
          { field: "messages", value: { metadata: { phone_number_id: "555" }, statuses: [{ id: "wamid.Z", status: "delivered" }] } },
        ],
      },
    ],
  });
  assertEquals(parsed.forms, []);
  const base = { numberId: "555", from: "77011234567", name: "Айгерим", sentAt: "2025-10-09T08:53:20.000Z", adId: null, referral: {} };
  assertEquals(parsed.messages, [
    {
      ...base,
      messageId: "wamid.A",
      adId: "120210000000001",
      text: "Здравствуйте",
      referral: { source_id: "120210000000001", source_url: "https://fb.me/x", headline: "Скидка", ctwa_clid: "clid1" },
    },
    { ...base, messageId: "wamid.B", text: "Здравствуйте" },
    { ...base, messageId: "wamid.C", text: "Здравствуйте", referral: { source_id: "777" } },
    { ...base, messageId: "wamid.D", text: "📷 Фото: вот такой" },
    { ...base, messageId: "wamid.E", text: "🎤 Голосовое сообщение" },
    { ...base, messageId: "wamid.G", text: "Хочу записаться" },
  ]);
});

Deno.test("мусор вместо уведомления не ломает разбор", () => {
  for (const payload of [null, "text", [], {}, { object: "page", entry: "x" }, { object: "page", entry: [{ changes: [null, 5] }] }]) {
    assertEquals(parseWebhook(payload), { forms: [], messages: [] });
  }
});

Deno.test("ответы формы: первое значение каждого поля", () => {
  assertEquals(
    fieldsOf([
      { name: "full_name", values: ["Айгерим С."] },
      { name: "phone_number", values: ["+77011234567", "лишнее"] },
      { name: "", values: ["x"] },
      { name: "city", values: [] },
    ]),
    { full_name: "Айгерим С.", phone_number: "+77011234567", city: "" },
  );
});

async function signedRequest(data: Record<string, unknown>, secret = SECRET): Promise<string> {
  const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const payload = b64(new TextEncoder().encode(JSON.stringify(data)));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return `${b64(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload))))}.${payload}`;
}

Deno.test("запрос на удаление данных: верная подпись даёт ID пользователя", async () => {
  const request = await signedRequest({ algorithm: "HMAC-SHA256", issued_at: 1760000000, user_id: "218471" });
  assertEquals(await parseSignedRequest(SECRET, request), "218471");
});

Deno.test("запрос на удаление данных: чужая подпись, другой алгоритм и мусор отклоняются", async () => {
  assertEquals(await parseSignedRequest(SECRET, await signedRequest({ algorithm: "HMAC-SHA256", user_id: "1" }, "other")), null);
  assertEquals(await parseSignedRequest(SECRET, await signedRequest({ algorithm: "plain", user_id: "1" })), null);
  assertEquals(await parseSignedRequest(SECRET, await signedRequest({ algorithm: "HMAC-SHA256" })), null);
  assertEquals(await parseSignedRequest(SECRET, "abc"), null);
  assertEquals(await parseSignedRequest(SECRET, ""), null);
  assertEquals(await parseSignedRequest("", await signedRequest({ algorithm: "HMAC-SHA256", user_id: "1" })), null);
});
