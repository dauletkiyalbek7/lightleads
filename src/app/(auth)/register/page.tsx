"use client";

import { AnimatePresence } from "framer-motion";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { AuthShell, GoogleMark } from "@/components/features/auth-shell";
import { Btn } from "@/components/kit/btn";
import { Field, Input } from "@/components/kit/field";
import { FadeIn } from "@/components/kit/motion";
import { t } from "@/i18n";

/** Регистрация в два шага: аккаунт → название workspace → онбординг. */
export default function RegisterPage() {
  const router = useRouter();
  const [step, setStep] = useState<"account" | "workspace">("account");

  const next = (e: FormEvent) => {
    e.preventDefault();
    setStep("workspace");
  };
  const create = (e: FormEvent) => {
    e.preventDefault();
    router.push("/onboarding");
  };

  return (
    <AuthShell
      title={step === "account" ? t.auth.registerTitle : t.auth.workspaceTitle}
      text={step === "account" ? t.auth.registerText : t.auth.workspaceText}
      footer={
        <>
          {t.auth.hasAccount}{" "}
          <Link href="/login" className="font-semibold text-brand hover:underline">
            {t.auth.toLogin}
          </Link>
        </>
      }
    >
      <AnimatePresence mode="wait" initial={false}>
        {step === "account" ? (
          <FadeIn key="account">
            <Btn variant="secondary" size="lg" className="w-full" onClick={() => setStep("workspace")}>
              <GoogleMark />
              {t.auth.google}
            </Btn>
            <div className="my-5 flex items-center gap-3 text-xs text-subtle">
              <span className="h-px flex-1 bg-border" />
              {t.auth.or}
              <span className="h-px flex-1 bg-border" />
            </div>
            <form onSubmit={next} className="space-y-4">
              <Field label={t.auth.name}>
                <Input autoComplete="name" required />
              </Field>
              <Field label={t.auth.email}>
                <Input type="email" autoComplete="email" placeholder="you@company.kz" required />
              </Field>
              <Field label={t.auth.password}>
                <Input type="password" autoComplete="new-password" placeholder="••••••••" required minLength={6} />
              </Field>
              <Btn type="submit" size="lg" className="w-full">
                {t.auth.register}
              </Btn>
            </form>
          </FadeIn>
        ) : (
          <FadeIn key="workspace">
            <form onSubmit={create} className="space-y-4">
              <Field label={t.settings.workspace.name}>
                <Input autoFocus placeholder={t.auth.workspacePlaceholder} required />
              </Field>
              <Btn type="submit" size="lg" className="w-full">
                {t.auth.createWorkspace}
              </Btn>
              <Btn variant="ghost" className="w-full" onClick={() => setStep("account")}>
                {t.common.back}
              </Btn>
            </form>
          </FadeIn>
        )}
      </AnimatePresence>
    </AuthShell>
  );
}
