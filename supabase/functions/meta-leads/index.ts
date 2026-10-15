// Edge Function `meta-leads`: лиды из Meta — лид-формы страниц Facebook и WhatsApp (Cloud API).
//   GET  ?hub.mode=subscribe…             — приложение Meta проверяет адрес вебхука
//   POST + X-Hub-Signature-256            — уведомление Meta: заявка из лид-формы или сообщение WhatsApp с рекламы
//   POST {action} + JWT                   — действия владельца: выдать доступ, выбрать страницы и номера
//   POST {action:"cron"} + x-cron-secret  — раз в час: дочитать пропущенные заявки форм и привязать лиды к новым объявлениям
//   POST signed_request (форма)           — Meta просит удалить данные человека, удалившего приложение (Data Deletion Callback)
// Вход в Facebook завершает функция `meta-oauth`: её адрес возврата уже разрешён в приложении Meta.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  admin,
  ALLOWED_ORIGINS,
  type Caller,
  connectionToken,
  CORS,
  getCaller,
  HttpError,
  json,
  redirectUri,
  requireManager,
  signState,
  SUPABASE_URL,
} from "../_shared/core.ts";
import { extractLead, normalizePhone } from "../leads/extract.ts";
import { DIALOG_URL, GRAPH_URL, graphGet, graphList, META_APP_ID, META_APP_SECRET, META_LOGIN_CONFIG_ID, META_SCOPES } from "../meta-oauth/lib.ts";
import { type AdClick, fieldsOf, type FormNotice, parseSignedRequest, parseWebhook, verifySignature, verifyToken } from "./webhook.ts";

const SECOND_MS = 1000;
const HOUR_MS = 60 * 60 * SECOND_MS;
const DAY_MS = 24 * HOUR_MS;
const STATE_TTL_MS = 15 * 60 * SECOND_MS;
/** Запас до лимита времени Edge Function (150 секунд). */
const CRON_BUDGET_MS = 110 * SECOND_MS;
/** Столько сразу после подключения страницы читаем её прошлые заявки; остальное дочитает плановая проверка. */
const FIRST_POLL_BUDGET_MS = 20 * SECOND_MS;
/** За сколько дней до подключения страницы забираем уже оставленные заявки. */
const BACKFILL_DAYS = 30;
/** Плановая проверка перечитывает последний час с запасом: уведомление и проверка могут разминуться. */
const POLL_OVERLAP_MS = HOUR_MS;
const MAX_NAME_LENGTH = 120;
const MAX_ERROR_LENGTH = 300;
const MAX_CHANNELS = 50;
const UNIQUE_VIOLATION = "23505";
/** Необязательно: конфигурация Facebook Login for Business с правами на страницы, лид-формы и WhatsApp. */
const LEADS_CONFIG_ID = Deno.env.get("META_LEADS_CONFIG_ID") ?? "";
const WEBHOOK_URL = `${SUPABASE_URL}/functions/v1/meta-leads`;
/** Страница, где человек видит, что его запрос на удаление выполнен. */
const DELETION_STATUS_URL = `${ALLOWED_ORIGINS[0]}/data-deletion`;
const CONFIRMATION_CODE_BYTES = 8;

const LEAD_FIELDS = "id,created_time,field_data";
/** ID объявления в заявке Meta отдаёт не при всех правах: просим его, а при отказе читаем без него. */
const LEAD_FIELDS_WITH_AD = `${LEAD_FIELDS},ad_id`;
/** Формы, которые не могли собрать заявок. */
const DEAD_FORM_STATUSES = ["DRAFT", "DELETED"];
const NO_PHONE_NOTE = "Последняя заявка пришла без телефона: такие заявки не сохраняются. Добавьте в форму вопрос «Номер телефона».";

type Kind = "meta_page" | "whatsapp";
type Feature = "forms" | "whatsapp";
type Body = Record<string, unknown>;

/** Права Facebook, которые нужны каждому источнику. Запрашиваются отдельно: без WhatsApp в приложении Meta его права недоступны. */
const FEATURE_SCOPES: Record<Feature, string[]> = {
  forms: ["pages_show_list", "pages_read_engagement", "pages_manage_metadata", "pages_manage_ads", "leads_retrieval"],
  whatsapp: ["business_management", "whatsapp_business_management", "whatsapp_business_messaging"],
};
/** Без этих прав источник не работает: по ним проверяем, что пользователь их действительно выдал. */
const REQUIRED_SCOPES: Record<Kind, string[]> = {
  meta_page: ["pages_show_list", "pages_manage_metadata", "leads_retrieval"],
  whatsapp: ["whatsapp_business_management"],
};
const KNOWN_SCOPES = new Set([...META_SCOPES, ...FEATURE_SCOPES.forms, ...FEATURE_SCOPES.whatsapp]);

interface Channel {
  id: string;
  workspace_id: string;
  kind: Kind;
  external_id: string;
  polled_at: string | null;
}
const CHANNEL_COLUMNS = "id, workspace_id, kind, external_id, polled_at";

/** Страница или номер, как их отдаёт Meta. token — токен страницы, наружу не выходит. */
interface Option {
  id: string;
  name: string;
  detail: string;
  parentId: string | null;
  token?: string;
}

interface GraphLead {
  id: string;
  created_time?: string;
  ad_id?: string;
  field_data?: unknown;
}

const isKind = (value: unknown): value is Kind => value === "meta_page" || value === "whatsapp";
const errorText = (error: unknown) => (error instanceof HttpError ? (error.detail ?? error.code) : String(error)).slice(0, MAX_ERROR_LENGTH);

// ---------- Graph API ----------

/** Запрос, который что-то меняет у Meta: подписка страницы или аккаунта WhatsApp на уведомления. */
async function graphSend(method: "POST" | "DELETE", path: string, params: Record<string, string>, token: string): Promise<void> {
  const url = new URL(`${GRAPH_URL}${path}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  url.searchParams.set("access_token", token);
  const response = await fetch(url, { method });
  const payload = (await response.json().catch(() => ({}))) as { error?: { message?: string } };
  if (!response.ok || payload.error) throw new HttpError(502, "platform_error", payload.error?.message ?? `HTTP ${response.status}`);
}

async function pageToken(pageId: string, userToken: string): Promise<string> {
  const page = await graphGet<{ access_token?: string }>(`/${pageId}`, { fields: "access_token" }, userToken);
  if (!page.access_token) throw new HttpError(502, "platform_error", "Facebook не дал доступ к странице. Проверьте, что у аккаунта есть права на неё.");
  return page.access_token;
}

async function listPages(token: string): Promise<Option[]> {
  const pages = await graphList<{ id: string; name?: string; access_token?: string }>("/me/accounts", { fields: "id,name,access_token", limit: "100" }, token);
  return pages.filter((page) => page.access_token).map((page) => ({ id: page.id, name: page.name ?? page.id, detail: "", parentId: null, token: page.access_token }));
}

/** Аккаунты WhatsApp Business, к которым пользователь дал доступ: из самого разрешения, а если там пусто — из его компаний. */
async function whatsappAccountIds(token: string): Promise<string[]> {
  const debug = await graphGet<{ data?: { granular_scopes?: { scope: string; target_ids?: string[] }[] } }>("/debug_token", {
    input_token: token,
    access_token: `${META_APP_ID}|${META_APP_SECRET}`,
  }).catch(() => ({ data: undefined }));
  const granted = (debug.data?.granular_scopes ?? []).filter((scope) => scope.scope === "whatsapp_business_management").flatMap((scope) => scope.target_ids ?? []);
  if (granted.length) return [...new Set(granted)];

  const businesses = await graphList<{ id: string }>("/me/businesses", { fields: "id", limit: "100" }, token).catch(() => []);
  const ids = new Set<string>();
  for (const business of businesses) {
    for (const edge of ["owned_whatsapp_business_accounts", "client_whatsapp_business_accounts"]) {
      const accounts = await graphList<{ id: string }>(`/${business.id}/${edge}`, { fields: "id", limit: "100" }, token).catch(() => []);
      accounts.forEach((account) => ids.add(account.id));
    }
  }
  return [...ids];
}

async function listNumbers(token: string): Promise<Option[]> {
  const numbers: Option[] = [];
  for (const accountId of await whatsappAccountIds(token)) {
    const phones = await graphList<{ id: string; display_phone_number?: string; verified_name?: string }>(
      `/${accountId}/phone_numbers`,
      { fields: "id,display_phone_number,verified_name", limit: "100" },
      token,
    );
    numbers.push(...phones.map((phone) => ({ id: phone.id, name: phone.verified_name ?? "", detail: phone.display_phone_number ?? phone.id, parentId: accountId })));
  }
  return numbers;
}

const listOptions = (kind: Kind, token: string) => (kind === "meta_page" ? listPages(token) : listNumbers(token));

/** Включает уведомления: страница шлёт новые заявки форм, аккаунт WhatsApp — входящие сообщения. */
async function subscribe(kind: Kind, option: Option, userToken: string) {
  if (kind === "meta_page") await graphSend("POST", `/${option.id}/subscribed_apps`, { subscribed_fields: "leadgen" }, option.token ?? userToken);
  else await graphSend("POST", `/${option.parentId}/subscribed_apps`, {}, userToken);
}

// ---------- Сохранение лидов ----------

async function defaultCountry(workspaceId: string): Promise<string> {
  const { data } = await admin.from("workspaces").select("default_country").eq("id", workspaceId).maybeSingle();
  return data?.default_country ?? "KZ";
}

interface NewLead {
  workspaceId: string;
  source: "meta_form" | "whatsapp";
  phone: string;
  name: string;
  /** ID заявки или сообщения у Meta: повторное уведомление не создаёт второй лид. */
  externalId: string;
  externalAdId: string | null;
  createdAt: string;
  payload: Record<string, unknown>;
}

/** true — лид добавлен; false — он уже был. */
async function saveLead(lead: NewLead): Promise<boolean> {
  const { data: existing } = await admin.from("leads").select("id").eq("workspace_id", lead.workspaceId).eq("source", lead.source).eq("external_id", lead.externalId).limit(1);
  if (existing?.length) return false;

  let refs: { campaign_id: string | null; adset_id: string | null; ad_id: string | null } = { campaign_id: null, adset_id: null, ad_id: null };
  if (lead.externalAdId) {
    const { data: ads } = await admin.from("ads").select("id, adset_id, campaign_id").eq("workspace_id", lead.workspaceId).eq("external_id", lead.externalAdId).limit(1);
    if (ads?.[0]) refs = { campaign_id: ads[0].campaign_id, adset_id: ads[0].adset_id, ad_id: ads[0].id };
  }
  const { error } = await admin.from("leads").insert({
    workspace_id: lead.workspaceId,
    phone: lead.phone,
    name: lead.name.slice(0, MAX_NAME_LENGTH),
    source: lead.source,
    platform: "meta",
    ...refs,
    external_id: lead.externalId,
    // Объявление могло ещё не загрузиться из кабинета: по этому ID лид привяжется к нему позже
    external_ad_id: lead.externalAdId,
    created_at: lead.createdAt,
    raw_payload: lead.payload,
  });
  if (error?.code === UNIQUE_VIOLATION) return false;
  if (error) throw new HttpError(500, "db_error", error.message);
  return true;
}

type Saved = "saved" | "duplicate" | "no_phone";

async function saveFormLead(channel: Channel, lead: GraphLead, formId: string | null, noticeAdId: string | null): Promise<Saved> {
  const extracted = extractLead(fieldsOf(lead.field_data), await defaultCountry(channel.workspace_id));
  if (!extracted.phone) return "no_phone";
  const added = await saveLead({
    workspaceId: channel.workspace_id,
    source: "meta_form",
    phone: extracted.phone,
    name: extracted.name,
    externalId: lead.id,
    externalAdId: noticeAdId ?? (lead.ad_id && lead.ad_id !== "0" ? lead.ad_id : null),
    createdAt: lead.created_time ?? new Date().toISOString(),
    payload: { page_id: channel.external_id, form_id: formId, field_data: lead.field_data ?? [] },
  });
  return added ? "saved" : "duplicate";
}

/** Отметка на канале: когда пришёл последний лид и что с ним не так. */
async function mark(channel: Channel, result: { saved?: boolean; error?: string | null; note?: string | null }) {
  const patch: Record<string, unknown> = result.error ? { status: "error", error: result.error } : { status: "active", error: result.note ?? null };
  if (result.saved) patch.last_lead_at = new Date().toISOString();
  await admin.from("lead_channels").update(patch).eq("id", channel.id);
}

async function findChannel(kind: Kind, externalId: string): Promise<Channel | null> {
  const { data } = await admin.from("lead_channels").select(CHANNEL_COLUMNS).eq("kind", kind).eq("external_id", externalId).maybeSingle();
  return data ?? null;
}

// ---------- Уведомления Meta ----------

/** Ошибку базы отдаём наружу (Meta пришлёт уведомление ещё раз), ошибку Meta записываем на канал. */
async function guarded(channel: Channel, work: () => Promise<void>) {
  try {
    await work();
  } catch (error) {
    if (error instanceof HttpError && error.code === "db_error") throw error;
    console.error("meta-leads channel failed:", channel.kind, errorText(error));
    await mark(channel, { error: errorText(error) });
  }
}

async function handleForm(notice: FormNotice) {
  const channel = await findChannel("meta_page", notice.pageId);
  if (!channel) return;
  await guarded(channel, async () => {
    const { token } = await connectionToken(channel.workspace_id, "meta");
    const lead = await graphGet<GraphLead>(`/${notice.leadId}`, { fields: LEAD_FIELDS }, await pageToken(channel.external_id, token));
    const saved = await saveFormLead(channel, lead, notice.formId, notice.adId);
    await mark(channel, { saved: saved === "saved", note: saved === "no_phone" ? NO_PHONE_NOTE : null });
  });
}

async function handleClick(click: AdClick) {
  const channel = await findChannel("whatsapp", click.numberId);
  if (!channel) return;
  await guarded(channel, async () => {
    const phone = normalizePhone(`+${click.from}`, await defaultCountry(channel.workspace_id));
    if (!phone) return;
    const saved = await saveLead({
      workspaceId: channel.workspace_id,
      source: "whatsapp",
      phone,
      name: click.name,
      externalId: click.messageId,
      externalAdId: click.adId,
      createdAt: click.sentAt,
      payload: { phone_number_id: click.numberId, referral: click.referral },
    });
    await mark(channel, { saved });
  });
}

async function webhook(req: Request): Promise<Response> {
  const raw = await req.text();
  if (!(await verifySignature(META_APP_SECRET, raw, req.headers.get("x-hub-signature-256")))) throw new HttpError(401, "bad_signature");
  let payload: unknown = null;
  try {
    payload = JSON.parse(raw);
  } catch {
    /* не JSON: разбор вернёт пустой список */
  }
  const { forms, clicks } = parseWebhook(payload);
  for (const notice of forms) await handleForm(notice);
  for (const click of clicks) await handleClick(click);
  return json({ ok: true });
}

/** Проверка адреса вебхука: Meta присылает строку, которую владелец платформы вписал в настройках приложения. */
async function verifyWebhook(url: URL): Promise<Response> {
  const valid = url.searchParams.get("hub.mode") === "subscribe" && META_APP_SECRET && url.searchParams.get("hub.verify_token") === (await verifyToken(META_APP_SECRET));
  return valid ? new Response(url.searchParams.get("hub.challenge") ?? "", { status: 200 }) : new Response("forbidden", { status: 403 });
}

// ---------- Удаление данных по запросу Meta ----------

/**
 * Человек удалил приложение LightLeads в настройках Facebook. Удаляем то, что получили о нём лично:
 * ключ доступа, имя и ID профиля Facebook. Рекламная статистика, заявки и продажи принадлежат
 * бизнесу-владельцу проекта и остаются; их удаляют вместе с проектом.
 */
async function dataDeletion(signedRequest: string) {
  const userId = await parseSignedRequest(META_APP_SECRET, signedRequest);
  if (!userId) throw new HttpError(400, "bad_signed_request");
  const code = Array.from(crypto.getRandomValues(new Uint8Array(CONFIRMATION_CODE_BYTES)), (b) => b.toString(16).padStart(2, "0")).join("");

  const { data: connections } = await admin.from("ad_connections").select("id, workspace_id").eq("platform", "meta").eq("external_user_id", userId);
  for (const connection of connections ?? []) {
    const { error } = await admin.from("ad_connection_secrets").delete().eq("connection_id", connection.id);
    if (error) throw new HttpError(500, "db_error", error.message);
    await admin
      .from("ad_connections")
      .update({ status: "disconnected", external_user_id: null, external_user_name: null, scopes: [], updated_at: new Date().toISOString() })
      .eq("id", connection.id);
  }
  // В журнал — только код и число подключений: ID профиля после удаления не храним
  await admin.from("audit_log").insert({ workspace_id: null, actor_id: null, action: "meta.data_deletion", details: { code, connections: connections?.length ?? 0 } });
  return { url: `${DELETION_STATUS_URL}?code=${code}`, confirmation_code: code };
}

// ---------- Плановая проверка лид-форм ----------

async function formLeads(formId: string, sinceMs: number, token: string): Promise<GraphLead[]> {
  const params = (fields: string) => ({
    fields,
    limit: "100",
    filtering: JSON.stringify([{ field: "time_created", operator: "GREATER_THAN", value: Math.floor(sinceMs / SECOND_MS) }]),
  });
  try {
    return await graphList<GraphLead>(`/${formId}/leads`, params(LEAD_FIELDS_WITH_AD), token);
  } catch (error) {
    if (!(error instanceof HttpError) || error.code !== "platform_error") throw error;
    return await graphList<GraphLead>(`/${formId}/leads`, params(LEAD_FIELDS), token);
  }
}

/** Дочитывает заявки всех форм страницы с прошлой проверки. Возвращает число новых лидов. */
async function pollPage(channel: Channel, userToken: string, deadline: number): Promise<number> {
  const startedAt = new Date().toISOString();
  const first = channel.polled_at === null;
  const sinceMs = first ? Date.now() - BACKFILL_DAYS * DAY_MS : Date.parse(channel.polled_at!) - POLL_OVERLAP_MS;
  const token = await pageToken(channel.external_id, userToken);
  const forms = await graphList<{ id: string; status?: string }>(`/${channel.external_id}/leadgen_forms`, { fields: "id,status", limit: "100" }, token);
  // Первый раз смотрим и архивные формы: в них могли остаться недавние заявки
  const wanted = forms.filter((form) => (first ? !DEAD_FORM_STATUSES.includes(form.status ?? "") : form.status === "ACTIVE"));

  let saved = 0;
  let noPhone = false;
  for (const form of wanted) {
    // Не успели: отметку времени не двигаем, следующая проверка начнёт с того же места
    if (Date.now() > deadline) return saved;
    for (const lead of await formLeads(form.id, sinceMs, token)) {
      const result = await saveFormLead(channel, lead, form.id, null);
      if (result === "saved") saved += 1;
      if (result === "no_phone") noPhone = true;
    }
  }
  await admin
    .from("lead_channels")
    .update({ polled_at: startedAt, status: "active", error: noPhone && !saved ? NO_PHONE_NOTE : null, ...(saved ? { last_lead_at: startedAt } : {}) })
    .eq("id", channel.id);
  return saved;
}

async function cron(req: Request) {
  const { data: secret } = await admin.from("app_secrets").select("value").eq("name", "cron_secret").maybeSingle();
  if (!secret?.value || req.headers.get("x-cron-secret") !== secret.value) throw new HttpError(401, "unauthorized");

  const deadline = Date.now() + CRON_BUDGET_MS;
  const { data: relinked } = await admin.rpc("relink_leads");
  const { data: channels } = await admin.from("lead_channels").select(CHANNEL_COLUMNS).eq("kind", "meta_page").order("polled_at", { ascending: true, nullsFirst: true });

  let leads = 0;
  let pages = 0;
  for (const channel of (channels ?? []) as Channel[]) {
    if (Date.now() > deadline) break;
    try {
      const { token } = await connectionToken(channel.workspace_id, "meta");
      leads += await pollPage(channel, token, deadline);
      pages += 1;
    } catch (error) {
      console.error("meta-leads poll failed:", errorText(error));
      await mark(channel, { error: errorText(error) });
    }
  }
  return { pages, leads, relinked: relinked ?? 0 };
}

// ---------- Действия владельца ----------

async function grantedScopes(workspaceId: string): Promise<string[]> {
  const { data } = await admin.from("ad_connections").select("status, scopes").eq("workspace_id", workspaceId).eq("platform", "meta").maybeSingle();
  if (!data || data.status === "disconnected") throw new HttpError(404, "not_connected");
  return data.scopes ?? [];
}

async function requireScopes(workspaceId: string, kind: Kind) {
  const granted = await grantedScopes(workspaceId);
  if (!REQUIRED_SCOPES[kind].every((scope) => granted.includes(scope))) throw new HttpError(403, "scope_missing");
}

/** Адрес окна Facebook, где пользователь добавляет права на страницы и лид-формы либо на WhatsApp. */
async function start(caller: Caller, body: Body) {
  const workspaceId = String(body.workspaceId ?? "");
  await requireManager(caller, workspaceId);
  const feature = String(body.feature ?? "") as Feature;
  if (!FEATURE_SCOPES[feature]) throw new HttpError(400, "unknown_feature");
  if (!META_APP_ID || !META_APP_SECRET) throw new HttpError(503, "not_configured");
  const origin = String(body.origin ?? "");
  if (!ALLOWED_ORIGINS.includes(origin)) throw new HttpError(400, "origin_not_allowed");
  const granted = await grantedScopes(workspaceId);

  const url = new URL(DIALOG_URL);
  url.searchParams.set("client_id", META_APP_ID);
  url.searchParams.set("redirect_uri", redirectUri("meta"));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", await signState({ w: workspaceId, u: caller.id, o: origin, exp: Date.now() + STATE_TTL_MS }));
  if (LEADS_CONFIG_ID) url.searchParams.set("config_id", LEADS_CONFIG_ID);
  // Уже выданные права просим снова: новый токен заменит старый и должен уметь всё то же
  else url.searchParams.set("scope", [...new Set([...META_SCOPES, ...granted.filter((scope) => KNOWN_SCOPES.has(scope)), ...FEATURE_SCOPES[feature]])].join(","));
  return { url: url.toString() };
}

async function channelInput(caller: Caller, body: Body): Promise<{ workspaceId: string; kind: Kind; token: string }> {
  const workspaceId = String(body.workspaceId ?? "");
  await requireManager(caller, workspaceId);
  if (!isKind(body.kind)) throw new HttpError(400, "unknown_kind");
  await requireScopes(workspaceId, body.kind);
  return { workspaceId, kind: body.kind, token: (await connectionToken(workspaceId, "meta")).token };
}

/** Страницы или номера, доступные аккаунту Facebook, с отметкой, какие уже подключены. */
async function options(caller: Caller, body: Body) {
  const { workspaceId, kind, token } = await channelInput(caller, body);
  const available = await listOptions(kind, token);
  const { data: saved } = available.length
    ? await admin.from("lead_channels").select("workspace_id, external_id").eq("kind", kind).in("external_id", available.map((option) => option.id))
    : { data: [] };
  const owner = new Map((saved ?? []).map((row) => [row.external_id, row.workspace_id]));
  return {
    options: available.map((option) => ({
      id: option.id,
      name: option.name,
      detail: option.detail,
      selected: owner.get(option.id) === workspaceId,
      // Уже подключено к другой компании: какой именно, не раскрываем
      taken: owner.has(option.id) && owner.get(option.id) !== workspaceId,
    })),
  };
}

async function select(caller: Caller, body: Body) {
  const { workspaceId, kind, token } = await channelInput(caller, body);
  const wanted = new Set(Array.isArray(body.ids) ? body.ids.map(String).slice(0, MAX_CHANNELS) : []);
  // Названия и принадлежность берём у Meta, а не из запроса браузера
  const available = await listOptions(kind, token);
  const { data } = await admin.from("lead_channels").select(CHANNEL_COLUMNS).eq("workspace_id", workspaceId).eq("kind", kind);
  const saved = (data ?? []) as Channel[];
  const savedIds = new Set(saved.map((channel) => channel.external_id));

  const added: Channel[] = [];
  const taken: string[] = [];
  for (const option of available.filter((item) => wanted.has(item.id) && !savedIds.has(item.id))) {
    if (await findChannel(kind, option.id)) {
      taken.push(option.name || option.detail);
      continue;
    }
    await subscribe(kind, option, token);
    const { data: created, error } = await admin
      .from("lead_channels")
      .insert({ workspace_id: workspaceId, kind, external_id: option.id, parent_id: option.parentId, name: option.name, detail: option.detail, created_by: caller.id })
      .select(CHANNEL_COLUMNS)
      .single();
    if (error?.code === UNIQUE_VIOLATION) taken.push(option.name || option.detail);
    else if (error || !created) throw new HttpError(500, "db_error", error?.message);
    else added.push(created as Channel);
  }

  const removed = saved.filter((channel) => !wanted.has(channel.external_id));
  for (const channel of removed) {
    const option = available.find((item) => item.id === channel.external_id);
    // Отписка страницы не критична: уведомления от неподключённой страницы просто пропускаются
    if (kind === "meta_page" && option?.token) await graphSend("DELETE", `/${option.id}/subscribed_apps`, {}, option.token).catch(() => undefined);
    await admin.from("lead_channels").delete().eq("id", channel.id);
  }
  if (added.length || removed.length) {
    await admin.from("audit_log").insert({ workspace_id: workspaceId, actor_id: caller.id, action: "lead_channels.changed", details: { kind, added: added.length, removed: removed.length } });
  }

  // Заявки, оставленные до подключения страницы, показываем сразу
  let leads = 0;
  const deadline = Date.now() + FIRST_POLL_BUDGET_MS;
  for (const channel of added) {
    if (kind !== "meta_page" || Date.now() > deadline) break;
    leads += await pollPage(channel, token, deadline).catch(async (error) => {
      await mark(channel, { error: errorText(error) });
      return 0;
    });
  }
  return { added: added.length, removed: removed.length, taken, leads };
}

/** Что владелец платформы вписывает в настройки вебхука приложения Meta. */
async function webhookInfo(caller: Caller) {
  if (!caller.isPlatformAdmin) throw new HttpError(403, "forbidden");
  if (!META_APP_SECRET) throw new HttpError(503, "not_configured");
  return { callbackUrl: WEBHOOK_URL, verifyToken: await verifyToken(META_APP_SECRET), deletionUrl: WEBHOOK_URL, privacyUrl: `${ALLOWED_ORIGINS[0]}/privacy` };
}

const ACTIONS: Record<string, (caller: Caller, body: Body) => Promise<unknown>> = { start, options, select, webhook_info: webhookInfo };

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    if (req.method === "GET") {
      const url = new URL(req.url);
      if (url.searchParams.has("hub.mode")) return await verifyWebhook(url);
      // Проверка настройки без раскрытия ключей: заданы ли они и каким способом приложение просит права
      return json({ configured: Boolean(META_APP_ID && META_APP_SECRET), loginConfig: Boolean(META_LOGIN_CONFIG_ID), leadsConfig: Boolean(LEADS_CONFIG_ID) });
    }
    if (req.method !== "POST") throw new HttpError(405, "method_not_allowed");
    if (req.headers.has("x-hub-signature-256")) return await webhook(req);
    if ((req.headers.get("content-type") ?? "").includes("application/x-www-form-urlencoded")) {
      const form = new URLSearchParams(await req.text());
      return json(await dataDeletion(form.get("signed_request") ?? ""));
    }

    const body = (await req.json().catch(() => ({}))) as Body;
    const name = String(body.action ?? "");
    if (name === "cron") return json(await cron(req));
    const action = ACTIONS[name];
    if (!action) throw new HttpError(400, "unknown_action");
    return json(await action(await getCaller(req), body));
  } catch (error) {
    if (error instanceof HttpError) {
      if (error.status >= 500) console.error("meta-leads failed:", error.code, error.detail ?? "");
      return json({ error: error.code, detail: error.detail }, error.status);
    }
    console.error(error);
    return json({ error: "internal" }, 500);
  }
});
