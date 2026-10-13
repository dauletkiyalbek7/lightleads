// Edge Function `leads`: приём лидов.
//   POST + ключ workspace (заголовок x-workspace-key, параметр ?key= или поле key) — заявка с сайта,
//        Tilda или любого вебхука. Открытый адрес: ключ только добавляет лиды, прочитать по нему ничего нельзя.
//   POST {action} + JWT — действия вошедшего пользователя: добавить лид вручную, удалить лид.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { admin, type Caller, getCaller, HttpError, requireMember } from "../_shared/core.ts";
import { extractLead, isProbe, normalizePhone, parseBody, type Utm } from "./extract.ts";

const MAX_BODY_BYTES = 32_000;
const MAX_NAME_LENGTH = 120;
const MINUTE_MS = 60_000;
/** Больше стольких заявок в минуту с одного ключа — это не люди, а сбой или накрутка. */
const MAX_LEADS_PER_MINUTE = 60;
/** Повторная отправка той же формы (двойной клик, сниппет и вебхук одновременно) — один лид. */
const DUPLICATE_WINDOW_MS = 10 * MINUTE_MS;
/** ID кампаний, групп и объявлений у Meta и TikTok — длинные числа. */
const EXTERNAL_ID_RE = /^\d{6,}$/;
const META_SOURCES = ["facebook", "fb", "instagram", "ig", "meta"];
const LEAD_COLUMNS = "id, phone, name, source, platform, campaign_id, adset_id, ad_id, created_at";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-workspace-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

type Body = Record<string, unknown>;

/** К чему привязан лид: объявление, его группа и кампания. */
interface Source {
  platform: "meta" | "tiktok" | null;
  campaign_id: string | null;
  adset_id: string | null;
  ad_id: string | null;
}

const NO_SOURCE: Source = { platform: null, campaign_id: null, adset_id: null, ad_id: null };

async function defaultCountry(workspaceId: string): Promise<string> {
  const { data } = await admin.from("workspaces").select("default_country").eq("id", workspaceId).maybeSingle();
  if (!data) throw new HttpError(404, "workspace_not_found");
  return data.default_country;
}

/**
 * Источник лида по UTM-меткам: в utm_content платформа подставляет ID объявления,
 * в utm_term — ID группы, в utm_campaign — ID кампании. Берём самый точный из найденных.
 */
async function sourceFromUtm(workspaceId: string, utm: Utm): Promise<Source> {
  const id = (value?: string) => (value && EXTERNAL_ID_RE.test(value) ? value : null);
  const adExternal = id(utm.utm_content);
  if (adExternal) {
    const { data } = await admin.from("ads").select("id, adset_id, campaign_id, platform").eq("workspace_id", workspaceId).eq("external_id", adExternal).limit(1);
    if (data?.[0]) return { platform: data[0].platform, campaign_id: data[0].campaign_id, adset_id: data[0].adset_id, ad_id: data[0].id };
  }
  const adsetExternal = id(utm.utm_term);
  if (adsetExternal) {
    const { data } = await admin.from("adsets").select("id, campaign_id, campaigns(platform)").eq("workspace_id", workspaceId).eq("external_id", adsetExternal).limit(1);
    const adset = data?.[0] as { id: string; campaign_id: string; campaigns: { platform: Source["platform"] } | null } | undefined;
    if (adset) return { platform: adset.campaigns?.platform ?? null, campaign_id: adset.campaign_id, adset_id: adset.id, ad_id: null };
  }
  const campaignExternal = id(utm.utm_campaign);
  if (campaignExternal) {
    const { data } = await admin.from("campaigns").select("id, platform").eq("workspace_id", workspaceId).eq("external_id", campaignExternal).limit(1);
    if (data?.[0]) return { platform: data[0].platform, campaign_id: data[0].id, adset_id: null, ad_id: null };
  }
  // Объявление не нашли, но платформу можно понять по utm_source
  const utmSource = (utm.utm_source ?? "").toLowerCase();
  if (utmSource.includes("tiktok")) return { ...NO_SOURCE, platform: "tiktok" };
  if (META_SOURCES.some((name) => utmSource.includes(name))) return { ...NO_SOURCE, platform: "meta" };
  return NO_SOURCE;
}

const matchLevel = (source: Source) => (source.ad_id ? "ad" : source.adset_id ? "adset" : source.campaign_id ? "campaign" : null);

// ---------- Заявка с сайта ----------

async function ingest(key: string, body: Body) {
  const { data: owner } = await admin.from("ingest_keys").select("workspace_id").eq("key", key).maybeSingle();
  if (!owner) throw new HttpError(401, "invalid_key", "Ключ workspace не найден. Скопируйте его заново в «Настройки → Источники лидов».");
  const workspaceId: string = owner.workspace_id;
  if (isProbe(body)) return { ok: true, test: true };

  const lead = extractLead(body, await defaultCountry(workspaceId));
  if (!lead.phone) throw new HttpError(422, "invalid_phone", "В заявке нет телефона или номер записан неверно. Поле должно называться phone.");

  const since = (ms: number) => new Date(Date.now() - ms).toISOString();
  const { count } = await admin
    .from("leads")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    .eq("source", "website")
    .gte("created_at", since(MINUTE_MS));
  if ((count ?? 0) >= MAX_LEADS_PER_MINUTE) throw new HttpError(429, "rate_limited");

  const source = await sourceFromUtm(workspaceId, lead.utm);

  // Та же заявка уже пришла: по номеру заявки сайта или тем же телефоном только что
  const sameLead = () => admin.from("leads").select("id, campaign_id").eq("workspace_id", workspaceId).eq("source", "website").order("created_at", { ascending: false }).limit(1);
  const byExternalId = lead.externalId ? (await sameLead().eq("external_id", lead.externalId)).data?.[0] : undefined;
  const existing = byExternalId ?? (await sameLead().eq("phone", lead.phone).gte("created_at", since(DUPLICATE_WINDOW_MS))).data?.[0];
  if (existing) {
    // Первая отправка могла прийти без меток (например, из вебхука), вторая — с ними: дополняем
    if (!existing.campaign_id && matchLevel(source)) await admin.from("leads").update({ ...source, utm: lead.utm }).eq("id", existing.id);
    return { ok: true, id: existing.id, duplicate: true };
  }

  // Сам ключ в сохранённую заявку не попадает
  const { key: _key, ...payload } = body;
  const { data: created, error } = await admin
    .from("leads")
    .insert({
      workspace_id: workspaceId,
      phone: lead.phone,
      name: lead.name,
      source: "website",
      ...source,
      external_id: lead.externalId,
      // Объявление могло ещё не загрузиться из кабинета: по этому ID лид привяжется к нему позже
      external_ad_id: EXTERNAL_ID_RE.test(lead.utm.utm_content ?? "") ? lead.utm.utm_content : null,
      utm: lead.utm,
      raw_payload: payload,
    })
    .select("id")
    .single();
  if (error || !created) throw new HttpError(500, "db_error", error?.message);
  return { ok: true, id: created.id, matched: matchLevel(source) };
}

// ---------- Действия пользователя ----------

async function addManual(caller: Caller, body: Body) {
  const workspaceId = String(body.workspaceId ?? "");
  await requireMember(caller, workspaceId);
  const phone = normalizePhone(String(body.phone ?? ""), await defaultCountry(workspaceId));
  if (!phone) throw new HttpError(422, "invalid_phone");

  // Источник менеджер выбирает из списка: проверяем, что объявление или кампания из этого workspace
  let source = NO_SOURCE;
  if (body.adId) {
    const { data: ad } = await admin.from("ads").select("id, adset_id, campaign_id, platform").eq("id", String(body.adId)).eq("workspace_id", workspaceId).maybeSingle();
    if (!ad) throw new HttpError(404, "ad_not_found");
    source = { platform: ad.platform, campaign_id: ad.campaign_id, adset_id: ad.adset_id, ad_id: ad.id };
  } else if (body.campaignId) {
    const { data: campaign } = await admin.from("campaigns").select("id, platform").eq("id", String(body.campaignId)).eq("workspace_id", workspaceId).maybeSingle();
    if (!campaign) throw new HttpError(404, "campaign_not_found");
    source = { ...NO_SOURCE, platform: campaign.platform, campaign_id: campaign.id };
  }

  const { data: lead, error } = await admin
    .from("leads")
    .insert({ workspace_id: workspaceId, phone, name: String(body.name ?? "").trim().slice(0, MAX_NAME_LENGTH), source: "manual", ...source, created_by: caller.id })
    .select(LEAD_COLUMNS)
    .single();
  if (error || !lead) throw new HttpError(500, "db_error", error?.message);
  return { lead };
}

async function remove(caller: Caller, body: Body) {
  const workspaceId = String(body.workspaceId ?? "");
  await requireMember(caller, workspaceId);
  const { data: removed, error } = await admin.from("leads").delete().eq("id", String(body.leadId ?? "")).eq("workspace_id", workspaceId).select("id, source");
  if (error) throw new HttpError(500, "db_error", error.message);
  if (!removed?.length) throw new HttpError(404, "lead_not_found");
  // В журнал телефон не пишем: только что и кем удалено
  await admin.from("audit_log").insert({ workspace_id: workspaceId, actor_id: caller.id, action: "lead.deleted", details: { lead_id: removed[0].id, source: removed[0].source } });
  return { ok: true };
}

const ACTIONS: Record<string, (caller: Caller, body: Body) => Promise<unknown>> = { add: addManual, delete: remove };

async function readBody(req: Request): Promise<Body> {
  const contentType = req.headers.get("content-type") ?? "";
  if (contentType.toLowerCase().includes("multipart/form-data")) {
    const form = await req.formData();
    return Object.fromEntries([...form.entries()].filter(([, value]) => typeof value === "string"));
  }
  const text = await req.text();
  if (text.length > MAX_BODY_BYTES) throw new HttpError(413, "payload_too_large");
  return parseBody(text, contentType);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    if (req.method !== "POST") throw new HttpError(405, "method_not_allowed");
    const body = await readBody(req);
    const key = req.headers.get("x-workspace-key") ?? new URL(req.url).searchParams.get("key") ?? (typeof body.key === "string" ? body.key : null);
    if (key) return json(await ingest(key.trim(), body));

    const action = ACTIONS[String(body.action ?? "")];
    if (!action) throw new HttpError(401, "key_required", "Передайте ключ workspace в заголовке x-workspace-key.");
    return json(await action(await getCaller(req), body));
  } catch (error) {
    if (error instanceof HttpError) {
      if (error.status >= 500) console.error("leads failed:", error.code, error.detail ?? "");
      return json({ error: error.code, detail: error.detail }, error.status);
    }
    console.error(error);
    return json({ error: "internal" }, 500);
  }
});
