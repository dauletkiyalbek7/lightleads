import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Регистрации нет (вход по приглашению): старые ссылки ведут на страницу входа
  redirects: async () => [{ source: "/register", destination: "/login", permanent: false }],
};

export default nextConfig;
