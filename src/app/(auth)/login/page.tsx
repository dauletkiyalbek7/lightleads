"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { AuthShell } from "@/components/features/auth-shell";
import { Btn } from "@/components/kit/btn";
import { Field, Input } from "@/components/kit/field";
import { t } from "@/i18n";
import { getBrowserSupabase } from "@/lib/supabase/client";

/** Supabase отвечает этим кодом и на неверный пароль, и на несуществующую почту. */
const INVALID_CREDENTIALS = "invalid_credentials";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setPending(true);
    setError(undefined);
    const { error: signInError } = await getBrowserSupabase().auth.signInWithPassword({ email: email.trim(), password });
    if (signInError) {
      setError(signInError.code === INVALID_CREDENTIALS ? t.auth.errorInvalid : t.auth.errorGeneric);
      setPending(false);
      return;
    }
    // Полная перезагрузка: сервер заново читает сессию и отдаёт данные пользователя
    window.location.assign("/dashboard");
  };

  return (
    <AuthShell
      title={t.auth.loginTitle}
      text={t.auth.loginText}
      footer={
        <Link href="/dashboard" className="font-semibold text-brand hover:underline">
          {t.auth.viewDemo}
        </Link>
      }
    >
      <form onSubmit={submit} className="space-y-4">
        <Field label={t.auth.email}>
          <Input type="email" autoComplete="email" placeholder="you@company.kz" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </Field>
        <Field label={t.auth.password} error={error}>
          <Input
            type="password"
            autoComplete="current-password"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-invalid={Boolean(error)}
            required
          />
        </Field>
        <Btn type="submit" size="lg" className="w-full" disabled={pending}>
          {t.auth.login}
        </Btn>
      </form>
      <p className="mt-5 text-center text-[13px] leading-relaxed text-muted-foreground">{t.auth.inviteOnly}</p>
    </AuthShell>
  );
}
