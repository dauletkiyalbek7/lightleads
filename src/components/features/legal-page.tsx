import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { Logo } from "@/components/kit/brand";
import { t } from "@/i18n";
import { LEGAL } from "@/lib/config";
import { formatDate } from "@/lib/dates";

/** Публичная страница с правовым текстом: политика конфиденциальности, удаление данных. */
export function LegalPage({ title, children }: { title: string; children: ReactNode }) {
  const s = t.legal;
  return (
    <div className="min-h-dvh bg-background">
      <header className="mx-auto flex h-16 max-w-3xl items-center justify-between gap-3 px-4 md:px-6">
        <Link href="/" aria-label={t.common.appName}>
          <Logo />
        </Link>
        <Link href="/" className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" />
          {s.back}
        </Link>
      </header>
      <main className="mx-auto max-w-3xl px-4 pt-6 pb-16 md:px-6">
        <h1 className="font-display text-2xl font-semibold tracking-tight md:text-3xl">{title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{s.updated(formatDate(LEGAL.updatedOn))}</p>
        <div className="mt-8 space-y-8 text-[15px] leading-relaxed">{children}</div>
        <Contacts />
      </main>
    </div>
  );
}

function Contacts() {
  const s = t.legal;
  if (!LEGAL.operator && !LEGAL.email) return <p className="mt-10 rounded-2xl bg-warning/10 p-4 text-sm">{s.contactsMissing}</p>;
  return (
    <dl className="mt-10 space-y-2 rounded-2xl bg-muted/60 p-5 text-sm">
      {LEGAL.operator && (
        <div>
          <dt className="text-muted-foreground">{s.operator}</dt>
          <dd className="font-medium">{LEGAL.operator}</dd>
        </div>
      )}
      {LEGAL.email && (
        <div>
          <dt className="text-muted-foreground">{s.contact}</dt>
          <dd className="font-medium">
            <a href={`mailto:${LEGAL.email}`} className="text-brand underline-offset-4 hover:underline">
              {LEGAL.email}
            </a>
          </dd>
        </div>
      )}
    </dl>
  );
}

export function LegalSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="font-display text-lg font-semibold tracking-tight">{title}</h2>
      <div className="mt-3 space-y-3 text-foreground/90">{children}</div>
    </section>
  );
}
