import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { SUPABASE_KEY, SUPABASE_URL } from "./env";

/** Клиент для серверных компонентов: читает сессию из cookies запроса. */
export async function createServerSupabase() {
  const store = await cookies();
  return createServerClient(SUPABASE_URL, SUPABASE_KEY, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          list.forEach(({ name, value, options }) => store.set(name, value, options));
        } catch {
          /* Серверный компонент не может писать cookies: сессию обновляет middleware. */
        }
      },
    },
  });
}
