import { assertEquals, assertRejects } from "jsr:@std/assert@1";

// lib.ts создаёт клиент базы при импорте: для теста хватает заглушек
Deno.env.set("SUPABASE_URL", "http://localhost");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test");
const { graphPage } = await import("./lib.ts");

const TOO_MUCH = { error: { code: 1, message: "Please reduce the amount of data you're asking for, then retry your request" } };

/** Подменяет fetch: отвечает по очереди из списка и запоминает, с каким limit был каждый запрос. */
function stubFetch(responses: { status: number; body: unknown }[]) {
  const limits: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (input: string | URL | Request) => {
    limits.push(new URL(String(input)).searchParams.get("limit") ?? "");
    const next = responses.shift()!;
    return Promise.resolve(new Response(JSON.stringify(next.body), { status: next.status }));
  };
  return { limits, restore: () => (globalThis.fetch = original) };
}

Deno.test("graphPage: на «слишком много данных» просит страницу вдвое меньше и сохраняет метку", async () => {
  const stub = stubFetch([
    { status: 500, body: TOO_MUCH },
    { status: 500, body: TOO_MUCH },
    { status: 200, body: { data: [{ id: "1" }], paging: { next: "https://next", cursors: { after: "B" } } } },
  ]);
  try {
    const page = await graphPage<{ id: string }>("/act_1/ads", { limit: "200" }, "token", "A");
    assertEquals(page, { data: [{ id: "1" }], after: "B" });
    assertEquals(stub.limits, ["200", "100", "50"]);
  } finally {
    stub.restore();
  }
});

Deno.test("graphPage: на самой маленькой странице ошибка доходит до вызывающего", async () => {
  const stub = stubFetch([{ status: 500, body: TOO_MUCH }, { status: 500, body: TOO_MUCH }]);
  try {
    await assertRejects(() => graphPage("/act_1/ads", { limit: "20" }, "token"));
    assertEquals(stub.limits, ["20", "10"]);
  } finally {
    stub.restore();
  }
});
