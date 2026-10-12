import type { Metadata, Viewport } from "next";
import { Onest, Unbounded } from "next/font/google";
import { Providers } from "@/components/providers";
import { t } from "@/i18n";
import { APP } from "@/lib/config";
import "./globals.css";

const onest = Onest({ variable: "--font-onest", subsets: ["latin", "cyrillic"], display: "swap" });
const unbounded = Unbounded({ variable: "--font-unbounded", subsets: ["latin", "cyrillic"], display: "swap" });

export const metadata: Metadata = {
  title: { default: `${APP.name} — ${t.landing.heroTitleA} ${t.landing.heroTitleB}`, template: `%s · ${APP.name}` },
  description: t.landing.heroText,
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#F6F7FB",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ru" className={`${onest.variable} ${unbounded.variable}`}>
      <body className="antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
