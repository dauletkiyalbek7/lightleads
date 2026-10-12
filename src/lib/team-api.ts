import { FunctionsHttpError } from "@supabase/supabase-js";
import { getBrowserSupabase } from "./supabase/client";
import type { Credentials } from "./types";

/** Запросы к Edge Function `team` (supabase/functions/team): аккаунты и состав workspace. */
type TeamRequest =
  | { action: "create_workspace"; name: string; ownerEmail: string; ownerName: string }
  | { action: "invite_member"; workspaceId: string; email: string; name: string }
  | { action: "remove_member"; workspaceId: string; userId: string }
  | { action: "reset_password"; userId: string }
  | { action: "delete_workspace"; workspaceId: string; confirmName: string };

export type TeamResult<T> = { ok: true; data: T } | { ok: false; error: string };

const FALLBACK_ERROR = "internal";

export async function callTeam<T = Credentials>(body: TeamRequest): Promise<TeamResult<T>> {
  const { data, error } = await getBrowserSupabase().functions.invoke<T>("team", { body });
  if (!error && data) return { ok: true, data };
  if (error instanceof FunctionsHttpError) {
    const payload = (await error.context.json().catch(() => null)) as { error?: string } | null;
    return { ok: false, error: payload?.error ?? FALLBACK_ERROR };
  }
  return { ok: false, error: FALLBACK_ERROR };
}
