"use client";

import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { NO_AD, useAdOptions } from "@/components/features/sale-dialog";
import { Btn } from "@/components/kit/btn";
import { Field, Input, Picker } from "@/components/kit/field";
import { Modal } from "@/components/kit/overlay";
import { t } from "@/i18n";
import { formatPhoneInput, normalizePhone } from "@/lib/phone";
import { useApp } from "@/lib/store";

/** Ручной лид: клиент пришёл сам, а менеджер указывает объявление-источник из списка. */
export function LeadDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const s = t.leads.form;
  const { ds, addLead } = useApp();
  const adOptions = useAdOptions(ds);
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [adId, setAdId] = useState(NO_AD);
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!open) return;
    setPhone("");
    setName("");
    setAdId(NO_AD);
    setError(undefined);
  }, [open]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const normalized = normalizePhone(phone);
    if (!normalized) return setError(s.phoneError);
    setPending(true);
    const result = await addLead({ phone: normalized, name: name.trim(), adId: adId === NO_AD ? null : adId });
    setPending(false);
    if (!result.ok) {
      if (result.error === "invalid_phone") setError(s.phoneError);
      else toast.error(s.failed);
      return;
    }
    onOpenChange(false);
    toast.success(s.success);
  };

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={s.title}
      description={s.subtitle}
      footer={
        <Btn type="submit" form="lead-form" size="lg" className="w-full" disabled={pending}>
          {s.submit}
        </Btn>
      }
    >
      <form id="lead-form" onSubmit={submit} className="space-y-4 pt-1" noValidate>
        <Field label={s.phone} error={error}>
          <Input
            type="tel"
            inputMode="tel"
            autoComplete="off"
            autoFocus
            placeholder={t.sales.form.phonePlaceholder}
            value={phone}
            aria-invalid={Boolean(error)}
            onChange={(e) => {
              setPhone(formatPhoneInput(e.target.value));
              setError(undefined);
            }}
            className="num h-13 text-lg font-semibold md:text-lg"
          />
        </Field>
        <Field label={s.name}>
          <Input autoComplete="off" placeholder={s.namePlaceholder} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label={s.source}>
          <Picker ariaLabel={s.source} value={adId} onChange={setAdId} options={adOptions} />
        </Field>
      </form>
    </Modal>
  );
}
