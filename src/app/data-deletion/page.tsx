import type { Metadata } from "next";
import { LegalPage, LegalSection } from "@/components/features/legal-page";
import { t } from "@/i18n";

export const metadata: Metadata = { title: t.legal.deletionTitle };

/** Код подтверждения из ответа на запрос Meta: буквы и цифры. */
const CODE_RE = /^[a-z0-9]{6,32}$/i;

/**
 * Удаление данных. Сюда ведёт ссылка, которую LightLeads возвращает Meta на запрос об удалении
 * (с кодом подтверждения), и эту же страницу можно указать в приложении Meta как инструкцию.
 */
export default async function DataDeletionPage({ searchParams }: { searchParams: Promise<{ code?: string }> }) {
  const s = t.legal;
  const { code } = await searchParams;
  return (
    <LegalPage title={s.deletionTitle}>
      {code && CODE_RE.test(code) && <p className="rounded-2xl bg-brand-soft/70 p-4 text-sm font-medium">{s.deletionStatus(code)}</p>}
      <LegalSection title={s.deletionIntro}>
        <ol className="list-decimal space-y-3 pl-5">
          {s.deletionSteps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      </LegalSection>
    </LegalPage>
  );
}
