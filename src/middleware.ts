import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isSupabaseConfigured, SUPABASE_KEY, SUPABASE_URL } from "@/lib/supabase/env";

const LOGIN_PATH = "/login";
const HOME_PATH = "/dashboard";
/** Разделы только для вошедших. Остальное приложение гостю открывается в демо-режиме. */
const PRIVATE_PREFIXES = ["/admin"];

/** Обновляет сессию Supabase в cookies и разводит гостей и вошедших по страницам. */
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });
  if (!isSupabaseConfigured) return response;

  const supabase = createServerClient(SUPABASE_URL, SUPABASE_KEY, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        list.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        list.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const redirectTo = (path: string) => {
    const redirect = NextResponse.redirect(new URL(path, request.url));
    response.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
    return redirect;
  };

  if (user && pathname === LOGIN_PATH) return redirectTo(HOME_PATH);
  if (!user && PRIVATE_PREFIXES.some((prefix) => pathname.startsWith(prefix))) return redirectTo(LOGIN_PATH);
  return response;
}

export const config = {
  // Скрипт для сайтов клиентов и приём лидов сессию не трогают
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|ll\\.js|api/ingest|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
