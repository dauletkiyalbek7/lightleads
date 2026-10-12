"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Btn } from "@/components/kit/btn";
import { CopyBlock } from "@/components/kit/field";
import { Modal } from "@/components/kit/overlay";
import { t } from "@/i18n";
import type { Credentials } from "@/lib/types";

interface Props {
  /** null — окно закрыто. */
  credentials: Credentials | null;
  onClose: () => void;
  /** Заголовок для случая, когда пароль выдан существующему аккаунту. */
  resetTitle?: boolean;
}

/** Показывает логин и пароль нового аккаунта. Пароль нигде не сохраняется и виден один раз. */
export function CredentialsDialog({ credentials, onClose, resetTitle }: Props) {
  const s = t.team;
  const [loginUrl, setLoginUrl] = useState("");
  useEffect(() => setLoginUrl(`${window.location.origin}/login`), []);

  const password = credentials?.password ?? null;
  const copyAll = async () => {
    if (!credentials || !password) return;
    const text = `${s.loginUrl}: ${loginUrl}\n${s.login}: ${credentials.email}\n${s.password}: ${password}`;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      /* буфер обмена недоступен — данные остаются на экране */
    }
    toast.success(s.copied);
  };

  return (
    <Modal
      open={credentials !== null}
      onOpenChange={(open) => !open && onClose()}
      title={password ? (resetTitle ? s.resetTitle : s.credentialsTitle) : s.existingTitle}
      description={password ? s.credentialsText : s.existingText}
      footer={
        <>
          {password && (
            <Btn variant="secondary" onClick={copyAll}>
              {s.copyAll}
            </Btn>
          )}
          <Btn onClick={onClose}>{s.done}</Btn>
        </>
      }
    >
      {credentials && (
        <div className="space-y-3">
          <CopyBlock label={s.loginUrl} text={loginUrl} />
          <CopyBlock label={s.login} text={credentials.email} />
          {password && <CopyBlock label={s.password} text={password} />}
        </div>
      )}
    </Modal>
  );
}
