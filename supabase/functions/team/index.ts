// Edge Function `team`: аккаунты и состав workspace.
// Регистрации в LightLeads нет: аккаунт создаёт владелец платформы или владелец workspace,
// а человек получает готовые логин и пароль. Сервисный ключ живёт только здесь, на сервере.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const PASSWORD_LENGTH = 14;
// Без похожих символов (0/O, 1/l/I), чтобы пароль можно было продиктовать
const PASSWORD_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_NAME_LENGTH = 120;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

class HttpError extends Error {
  constructor(public status: number, public code: string) {
    super(code);
  }
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

function generatePassword(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(PASSWORD_LENGTH));
  return Array.from(bytes, (b) => PASSWORD_ALPHABET[b % PASSWORD_ALPHABET.length]).join("");
}

function cleanEmail(value: unknown): string {
  const email = String(value ?? "").trim().toLowerCase();
  if (!EMAIL_RE.test(email)) throw new HttpError(400, "invalid_email");
  return email;
}

function cleanName(value: unknown, required = false): string {
  const name = String(value ?? "").trim().slice(0, MAX_NAME_LENGTH);
  if (required && !name) throw new HttpError(400, "name_required");
  return name;
}

interface Caller {
  id: string;
  isPlatformAdmin: boolean;
}

async function getCaller(req: Request): Promise<Caller> {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) throw new HttpError(401, "unauthorized");
  const { data: profile } = await admin.from("profiles").select("is_platform_admin").eq("id", data.user.id).maybeSingle();
  return { id: data.user.id, isPlatformAdmin: profile?.is_platform_admin === true };
}

async function memberRole(workspaceId: string, userId: string): Promise<"owner" | "member" | null> {
  const { data } = await admin
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .maybeSingle();
  return (data?.role as "owner" | "member" | undefined) ?? null;
}

async function requireManager(caller: Caller, workspaceId: string) {
  if (!workspaceId) throw new HttpError(400, "workspace_required");
  if (caller.isPlatformAdmin) return;
  if ((await memberRole(workspaceId, caller.id)) !== "owner") throw new HttpError(403, "forbidden");
}

/** Находит пользователя по почте или создаёт нового. Пароль возвращается только для нового. */
async function findOrCreateUser(email: string, name: string): Promise<{ id: string; password: string | null }> {
  const { data: existing } = await admin.from("profiles").select("id").eq("email", email).maybeSingle();
  if (existing) return { id: existing.id, password: null };

  const password = generatePassword();
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: name },
  });
  if (error || !data.user) throw new HttpError(400, "user_create_failed");
  return { id: data.user.id, password };
}

async function audit(workspaceId: string | null, actorId: string, action: string, details: Record<string, unknown>) {
  await admin.from("audit_log").insert({ workspace_id: workspaceId, actor_id: actorId, action, details });
}

async function createWorkspace(caller: Caller, body: Record<string, unknown>) {
  if (!caller.isPlatformAdmin) throw new HttpError(403, "forbidden");
  const name = cleanName(body.name, true);
  const ownerEmail = cleanEmail(body.ownerEmail);
  const ownerName = cleanName(body.ownerName);

  const owner = await findOrCreateUser(ownerEmail, ownerName);
  const { data: workspace, error } = await admin
    .from("workspaces")
    .insert({ name, created_by: caller.id })
    .select("id, name")
    .single();
  if (error || !workspace) throw new HttpError(500, "workspace_create_failed");

  const { error: memberError } = await admin
    .from("workspace_members")
    .insert({ workspace_id: workspace.id, user_id: owner.id, role: "owner" });
  if (memberError) throw new HttpError(500, "member_add_failed");

  await audit(workspace.id, caller.id, "workspace.created", { name, owner_email: ownerEmail });
  return { workspace, email: ownerEmail, password: owner.password };
}

async function inviteMember(caller: Caller, body: Record<string, unknown>) {
  const workspaceId = String(body.workspaceId ?? "");
  await requireManager(caller, workspaceId);
  const email = cleanEmail(body.email);
  const name = cleanName(body.name);

  const user = await findOrCreateUser(email, name);
  if (await memberRole(workspaceId, user.id)) throw new HttpError(409, "already_member");

  const { error } = await admin.from("workspace_members").insert({ workspace_id: workspaceId, user_id: user.id, role: "member" });
  if (error) throw new HttpError(500, "member_add_failed");

  await audit(workspaceId, caller.id, "member.invited", { email });
  return { userId: user.id, email, password: user.password };
}

async function removeMember(caller: Caller, body: Record<string, unknown>) {
  const workspaceId = String(body.workspaceId ?? "");
  const userId = String(body.userId ?? "");
  await requireManager(caller, workspaceId);
  if (userId === caller.id) throw new HttpError(400, "cannot_remove_self");

  const role = await memberRole(workspaceId, userId);
  if (!role) throw new HttpError(404, "not_member");
  // Владельца workspace может убрать только владелец платформы
  if (role === "owner" && !caller.isPlatformAdmin) throw new HttpError(403, "forbidden");

  const { error } = await admin.from("workspace_members").delete().eq("workspace_id", workspaceId).eq("user_id", userId);
  if (error) throw new HttpError(500, "member_remove_failed");

  await audit(workspaceId, caller.id, "member.removed", { user_id: userId });
  return { ok: true };
}

/**
 * Новый пароль выдаёт только владелец платформы: один человек может состоять в нескольких
 * workspace, и сброс пароля владельцем одного из них открыл бы ему чужие данные.
 */
async function resetPassword(caller: Caller, body: Record<string, unknown>) {
  if (!caller.isPlatformAdmin) throw new HttpError(403, "forbidden");
  const userId = String(body.userId ?? "");
  const { data: profile } = await admin.from("profiles").select("email").eq("id", userId).maybeSingle();
  if (!profile) throw new HttpError(404, "user_not_found");

  const password = generatePassword();
  const { error } = await admin.auth.admin.updateUserById(userId, { password });
  if (error) throw new HttpError(500, "password_reset_failed");

  await audit(null, caller.id, "password.reset", { user_id: userId });
  return { email: profile.email, password };
}

const ACTIONS: Record<string, (caller: Caller, body: Record<string, unknown>) => Promise<unknown>> = {
  create_workspace: createWorkspace,
  invite_member: inviteMember,
  remove_member: removeMember,
  reset_password: resetPassword,
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    if (req.method !== "POST") throw new HttpError(405, "method_not_allowed");
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const action = ACTIONS[String(body.action ?? "")];
    if (!action) throw new HttpError(400, "unknown_action");
    const caller = await getCaller(req);
    return json(await action(caller, body));
  } catch (error) {
    if (error instanceof HttpError) return json({ error: error.code }, error.status);
    console.error(error);
    return json({ error: "internal" }, 500);
  }
});
