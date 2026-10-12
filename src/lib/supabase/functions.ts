import { FunctionsHttpError } from "@supabase/supabase-js";
import { getBrowserSupabase } from "./client";

/** Ответ Edge Function: данные либо код ошибки (и пояснение, если сервер его дал). */
export type FnResult<T> = { ok: true; data: T } | { ok: false; error: string; detail?: string };

const FALLBACK_ERROR = "internal";

/** Вызов Edge Function от имени вошедшего пользователя. */
export async function callFunction<T>(name: string, body: Record<string, unknown>): Promise<FnResult<T>> {
  const { data, error } = await getBrowserSupabase().functions.invoke<T>(name, { body });
  if (!error && data) return { ok: true, data };
  if (error instanceof FunctionsHttpError) {
    const payload = (await error.context.json().catch(() => null)) as { error?: string; detail?: string } | null;
    return { ok: false, error: payload?.error ?? FALLBACK_ERROR, detail: payload?.detail };
  }
  return { ok: false, error: FALLBACK_ERROR };
}
