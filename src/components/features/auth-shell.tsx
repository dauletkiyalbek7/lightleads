import { Check } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { Logo } from "@/components/kit/brand";
import { t } from "@/i18n";

/** Экран входа: форма слева, яркая панель справа (на телефоне скрыта). */
export function AuthShell({ title, text, children, footer }: { title: string; text: string; children: ReactNode; footer: ReactNode }) {
  return (
    <div className="grid min-h-dvh bg-background lg:grid-cols-2">
      <div className="flex flex-col px-5 py-6 md:px-10">
        <Link href="/" aria-label={t.common.appName} className="self-start">
          <Logo />
        </Link>
        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-10">
          <h1 className="font-display text-2xl font-semibold tracking-tight md:text-[28px]">{title}</h1>
          <p className="mt-2 text-sm text-muted-foreground">{text}</p>
          <div className="mt-8">{children}</div>
          <div className="mt-6 text-center text-sm text-muted-foreground">{footer}</div>
        </div>
        <Link href="/privacy" className="self-center text-xs text-subtle hover:text-foreground">
          {t.legal.links.privacy}
        </Link>
      </div>

      <div className="relative hidden overflow-hidden p-3 lg:block">
        <div className="bg-brand-gradient relative flex h-full flex-col justify-end overflow-hidden rounded-[32px] p-12 text-on-brand">
          <span className="absolute -top-24 -right-16 size-80 rounded-full bg-white/15 blur-2xl" />
          <span className="absolute top-1/3 -left-20 size-72 rounded-full bg-brand-glow/40 blur-3xl" />
          <span className="absolute right-10 bottom-1/3 size-40 rounded-full bg-brand-glow-2/40 blur-3xl" />
          <div className="relative">
            <h2 className="font-display max-w-md text-3xl leading-tight font-semibold tracking-tight">{t.auth.sideTitle}</h2>
            <ul className="mt-8 space-y-3">
              {t.auth.sidePoints.map((point) => (
                <li key={point} className="flex items-center gap-3 text-[15px]">
                  <span className="inline-flex size-7 items-center justify-center rounded-full bg-white/20">
                    <Check className="size-4" strokeWidth={3} />
                  </span>
                  {point}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
