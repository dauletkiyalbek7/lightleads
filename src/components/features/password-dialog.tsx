"use client";

import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Btn } from "@/components/kit/btn";
import { Field, Input } from "@/components/kit/field";
import { Modal } from "@/components/kit/overlay";
import { t } from "@/i18n";
import { getBrowserSupabase } from "@/lib/supabase/client";

const MIN_PASSWORD_LENGTH = 8;
const FORM_ID = "password-form";

/** Смена собственного пароля: выданный при приглашении пароль стоит заменить на свой. */
export function PasswordDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const s = t.account;
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);

  const close = (next: boolean) => {
    if (!next) {
      setPassword("");
      setRepeat("");
      setError(undefined);
    }
    onOpenChange(next);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (password.length < MIN_PASSWORD_LENGTH) return setError(s.passwordShort);
    if (password !== repeat) return setError(s.passwordMismatch);
    setPending(true);
    const { error: updateError } = await getBrowserSupabase().auth.updateUser({ password });
    setPending(false);
    if (updateError) return setError(s.passwordFailed);
    toast.success(s.passwordChanged);
    close(false);
  };

  return (
    <Modal
      open={open}
      onOpenChange={close}
      title={s.passwordTitle}
      description={s.passwordText}
      footer={
        <Btn type="submit" form={FORM_ID} disabled={pending}>
          {t.common.save}
        </Btn>
      }
    >
      <form id={FORM_ID} onSubmit={submit} className="space-y-4">
        <Field label={s.passwordNew}>
          <Input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <Field label={s.passwordRepeat} error={error}>
          <Input type="password" autoComplete="new-password" value={repeat} onChange={(e) => setRepeat(e.target.value)} aria-invalid={Boolean(error)} />
        </Field>
      </form>
    </Modal>
  );
}
