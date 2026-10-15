"use client";

import { Check, Copy, Search } from "lucide-react";
import { useState, type ComponentProps, type ReactNode } from "react";
import { toast } from "sonner";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";

/** text-base на телефоне — чтобы iOS не увеличивал страницу при фокусе. */
export const inputClass =
  "h-11 w-full rounded-xl border border-border bg-card px-3.5 text-base outline-none transition placeholder:text-subtle focus:border-brand focus:ring-4 focus:ring-brand/15 aria-invalid:border-danger aria-invalid:ring-danger/15 md:text-[15px]";

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input className={cn(inputClass, className)} {...props} />;
}

interface FieldProps {
  label: ReactNode;
  hint?: ReactNode;
  error?: string;
  className?: string;
  children: ReactNode;
}

export function Field({ label, hint, error, className, children }: FieldProps) {
  return (
    <label className={cn("flex flex-col gap-1.5", className)}>
      <span className="text-[13px] font-medium text-muted-foreground">{label}</span>
      {children}
      {error ? (
        <span className="text-xs font-medium text-danger">{error}</span>
      ) : (
        hint && <span className="text-xs text-subtle">{hint}</span>
      )}
    </label>
  );
}

export function SearchInput({ className, ...props }: ComponentProps<"input">) {
  return (
    <span className={cn("relative block", className)}>
      <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-subtle" />
      <input type="search" className={cn(inputClass, "pl-10")} {...props} />
    </span>
  );
}

interface PickerProps<T extends string> {
  value: T;
  onChange: (value: T) => void;
  options: readonly { value: T; label: ReactNode }[];
  placeholder?: string;
  className?: string;
  ariaLabel?: string;
}

/** Обёртка над shadcn Select в стиле наших полей. */
export function Picker<T extends string>({ value, onChange, options, placeholder, className, ariaLabel }: PickerProps<T>) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as T)}>
      <SelectTrigger
        aria-label={ariaLabel}
        className={cn("w-full rounded-xl border-border bg-card px-3.5 text-base data-[size=default]:h-11 md:text-[15px]", className)}
      >
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent className="max-h-72 rounded-2xl">
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value} className="min-h-10 rounded-xl">
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

const COPIED_RESET_MS = 1600;

export function CopyButton({ text, className }: { text: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      /* буфер обмена недоступен (http или старый браузер) — просто показываем подтверждение */
    }
    setCopied(true);
    toast.success(t.common.copied);
    window.setTimeout(() => setCopied(false), COPIED_RESET_MS);
  };
  return (
    <button
      type="button"
      onClick={copy}
      aria-label={t.common.copy}
      className={cn(
        "inline-flex size-11 shrink-0 items-center justify-center rounded-xl text-muted-foreground transition hover:bg-brand-soft hover:text-brand md:size-9",
        className,
      )}
    >
      {copied ? <Check className="size-4 text-success" /> : <Copy className="size-4" />}
    </button>
  );
}

/** Строка/блок кода с кнопкой копирования (UTM, сниппет, вебхук). */
/** tall — длинный текст (скрипт): показываем начало с прокруткой, копируется целиком. */
export function CopyBlock({ text, multiline, tall, label }: { text: string; multiline?: boolean; tall?: boolean; label?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-border bg-muted/60">
      {label && <div className="flex items-center gap-2 px-3.5 pt-3 text-xs font-medium text-muted-foreground">{label}</div>}
      <div className="flex items-start gap-1 py-1.5 pr-1.5 pl-3.5">
        <code
          className={cn(
            "min-w-0 flex-1 py-2 font-mono text-[12.5px] leading-relaxed text-foreground",
            multiline ? "whitespace-pre-wrap break-words" : "no-scrollbar overflow-x-auto whitespace-nowrap",
            tall && "max-h-64 overflow-y-auto",
          )}
        >
          {text}
        </code>
        <CopyButton text={text} />
      </div>
    </div>
  );
}
