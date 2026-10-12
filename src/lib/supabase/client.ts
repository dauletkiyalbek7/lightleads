import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_KEY, SUPABASE_URL } from "./env";

let client: SupabaseClient | undefined;

/** Клиент для браузера. Работает от имени вошедшего пользователя, доступ ограничивает RLS. */
export function getBrowserSupabase(): SupabaseClient {
  client ??= createBrowserClient(SUPABASE_URL, SUPABASE_KEY);
  return client;
}
