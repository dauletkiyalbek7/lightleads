import { assert, assertEquals } from "jsr:@std/assert@1";
import type { OutgoingMessage } from "./message.ts";

// bot.ts при импорте создаёт клиент базы и читает токен бота: для теста хватает заглушек
Deno.env.set("SUPABASE_URL", "http://localhost");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test");
Deno.env.set("TELEGRAM_BOT_TOKEN", "123:test");
const { send } = await import("./bot.ts");

interface Call {
  method: string;
  fields: Record<string, unknown>;
  file: boolean;
}

/** Подменяет fetch: отвечает по очереди из списка и запоминает метод Bot API и поля запроса. */
function stubFetch(responses: { status: number; body: unknown }[]) {
  const calls: Call[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const method = String(input).split("/").at(-1) ?? "";
    if (init?.body instanceof FormData) {
      const fields: Record<string, unknown> = {};
      let file = false;
      for (const [key, value] of init.body.entries()) {
        if (value instanceof File) file = true;
        fields[key] = value instanceof File ? value.name : value;
      }
      calls.push({ method, fields, file });
    } else {
      calls.push({ method, fields: JSON.parse(String(init?.body ?? "{}")), file: false });
    }
    const next = responses.shift()!;
    return new Response(JSON.stringify(next.body), { status: next.status });
  };
  return { calls, restore: () => (globalThis.fetch = original) };
}

const ok = (result: unknown) => ({ status: 200, body: { ok: true, result } });

Deno.test("send: текст — sendMessage с кнопками", async () => {
  const stub = stubFetch([ok({ message_id: 7 })]);
  try {
    assertEquals(await send(1, { text: "Привет", buttons: [{ text: "A", url: "https://a" }] }), 7);
    assertEquals(stub.calls[0].method, "sendMessage");
    assertEquals(stub.calls[0].fields.reply_markup, { inline_keyboard: [[{ text: "A", url: "https://a" }]] });
  } finally {
    stub.restore();
  }
});

Deno.test("send: файл загружается один раз, в следующий чат уходит по ID", async () => {
  const stub = stubFetch([ok({ message_id: 1, photo: [{ file_id: "small" }, { file_id: "big" }] }), ok({ message_id: 2, photo: [{ file_id: "big" }] })]);
  try {
    const message: OutgoingMessage = { text: "подпись", buttons: [{ text: "✅ Продажа", callback_data: "sale:1" }], attachment: { kind: "photo", file: new File(["x"], "photo.jpeg") } };
    assertEquals(await send(10, message), 1);
    assertEquals(await send(20, message), 2);
    assertEquals(stub.calls[0], {
      method: "sendPhoto",
      file: true,
      fields: { chat_id: "10", parse_mode: "HTML", reply_markup: JSON.stringify({ inline_keyboard: [[{ text: "✅ Продажа", callback_data: "sale:1" }]] }), caption: "подпись", photo: "photo.jpeg" },
    });
    assertEquals(stub.calls[1].method, "sendPhoto");
    assertEquals(stub.calls[1].file, false);
    assertEquals(stub.calls[1].fields.photo, "big");
  } finally {
    stub.restore();
  }
});

Deno.test("send: файл, который Telegram не принял как голосовое, уходит документом", async () => {
  const stub = stubFetch([
    { status: 400, body: { ok: false, error_code: 400, description: "Bad Request: VOICE_MESSAGES_FORBIDDEN" } },
    ok({ message_id: 3, document: { file_id: "doc" } }),
  ]);
  try {
    const message: OutgoingMessage = { text: "", buttons: [], attachment: { kind: "voice", file: new File(["x"], "voice.ogg") } };
    assertEquals(await send(1, message), 3);
    assertEquals(stub.calls.map((call) => call.method), ["sendVoice", "sendDocument"]);
    assertEquals(message.attachment, { kind: "document", file: "doc" });
  } finally {
    stub.restore();
  }
});

Deno.test("send: бот заблокирован — ошибка доходит до рассылки, документом не повторяем", async () => {
  const stub = stubFetch([{ status: 403, body: { ok: false, error_code: 403, description: "Forbidden: bot was blocked by the user" } }]);
  try {
    let failed = false;
    await send(1, { text: "", buttons: [], attachment: { kind: "photo", file: new File(["x"], "p.jpeg") } }).catch(() => (failed = true));
    assert(failed);
    assertEquals(stub.calls.length, 1);
  } finally {
    stub.restore();
  }
});
