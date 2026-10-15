"use client";

import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Btn } from "@/components/kit/btn";
import { Field, Input } from "@/components/kit/field";
import { Modal } from "@/components/kit/overlay";
import { t } from "@/i18n";
import { callTeam, openProject } from "@/lib/team-api";

const FORM_ID = "new-project-form";

/**
 * Создание своего проекта: человек становится его владельцем и попадает в настройки,
 * чтобы подключить рекламный кабинет.
 */
export function NewProjectDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const s = t.projects;
  const [name, setName] = useState("");
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return setError(t.team.errors.name_required);
    setPending(true);
    const result = await callTeam<{ workspace: { id: string } }>({ action: "create_project", name: name.trim() });
    if (!result.ok) {
      setPending(false);
      return setError(t.team.errors[result.error] ?? t.common.genericError);
    }
    toast.success(s.created);
    openProject(result.data.workspace.id);
  };

  return (
    <Modal
      open={open}
      onOpenChange={(next) => !pending && onOpenChange(next)}
      title={s.newTitle}
      description={s.newText}
      footer={
        <Btn type="submit" form={FORM_ID} className="w-full sm:w-auto" disabled={pending}>
          {s.create}
        </Btn>
      }
    >
      <form id={FORM_ID} onSubmit={submit}>
        <Field label={s.name} error={error}>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={s.namePlaceholder} autoComplete="off" autoFocus aria-invalid={Boolean(error)} />
        </Field>
      </form>
    </Modal>
  );
}
