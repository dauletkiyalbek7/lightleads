import type { NextConfig } from "next";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;

const nextConfig: NextConfig = {
  // Регистрации нет (вход по приглашению): старые ссылки ведут на страницу входа
  redirects: async () => [{ source: "/register", destination: "/login", permanent: false }],
  // Приём лидов с сайтов клиентов: адрес на нашем домене, а обрабатывает его Edge Function `leads`
  rewrites: async () => (SUPABASE_URL ? [{ source: "/api/ingest/lead", destination: `${SUPABASE_URL}/functions/v1/leads` }] : []),
};

export default nextConfig;
