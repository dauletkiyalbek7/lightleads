import type { Metadata } from "next";
import { LegalPage, LegalSection } from "@/components/features/legal-page";
import { t } from "@/i18n";

export const metadata: Metadata = { title: t.legal.privacyTitle };

/** Политика конфиденциальности. Её адрес указывается в приложении Meta для проверки (App Review). */
export default function PrivacyPage() {
  const s = t.legal;
  return (
    <LegalPage title={s.privacyTitle}>
      {s.privacy.map((section) => (
        <LegalSection key={section.title} title={section.title}>
          {section.text.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
        </LegalSection>
      ))}
      <LegalSection title={s.englishTitle}>
        {s.privacyEn.map((paragraph) => (
          <p key={paragraph} lang="en">
            {paragraph}
          </p>
        ))}
      </LegalSection>
    </LegalPage>
  );
}
