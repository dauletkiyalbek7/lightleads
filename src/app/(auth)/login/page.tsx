"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { FormEvent } from "react";
import { AuthShell, GoogleMark } from "@/components/features/auth-shell";
import { Btn } from "@/components/kit/btn";
import { Field, Input } from "@/components/kit/field";
import { t } from "@/i18n";

export default function LoginPage() {
  const router = useRouter();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    router.push("/dashboard");
  };
  return (
    <AuthShell
      title={t.auth.loginTitle}
      text={t.auth.loginText}
      footer={
        <>
          {t.auth.noAccount}{" "}
          <Link href="/register" className="font-semibold text-brand hover:underline">
            {t.auth.toRegister}
          </Link>
        </>
      }
    >
      <Btn variant="secondary" size="lg" className="w-full" onClick={() => router.push("/dashboard")}>
        <GoogleMark />
        {t.auth.google}
      </Btn>
      <div className="my-5 flex items-center gap-3 text-xs text-subtle">
        <span className="h-px flex-1 bg-border" />
        {t.auth.or}
        <span className="h-px flex-1 bg-border" />
      </div>
      <form onSubmit={submit} className="space-y-4">
        <Field label={t.auth.email}>
          <Input type="email" autoComplete="email" placeholder="you@company.kz" defaultValue="daulet@aromahouse.kz" />
        </Field>
        <Field label={t.auth.password}>
          <Input type="password" autoComplete="current-password" placeholder="••••••••" defaultValue="demo-password" />
        </Field>
        <Btn type="submit" size="lg" className="w-full">
          {t.auth.login}
        </Btn>
      </form>
    </AuthShell>
  );
}
