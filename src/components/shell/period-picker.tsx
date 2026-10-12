"use client";

import { format, parseISO } from "date-fns";
import { CalendarDays, ChevronDown } from "lucide-react";
import { useState } from "react";
import type { DateRange as PickerRange } from "react-day-picker";
import { ru } from "react-day-picker/locale";
import { Pop } from "@/components/kit/overlay";
import { Calendar } from "@/components/ui/calendar";
import { Switch } from "@/components/ui/switch";
import { t } from "@/i18n";
import { formatRange, PERIOD_PRESETS, type PeriodPreset } from "@/lib/dates";
import { useApp } from "@/lib/store";
import { cn } from "@/lib/utils";

const ISO = "yyyy-MM-dd";

/** Глобальный выбор периода + сравнение с прошлым периодом. */
export function PeriodPicker({ className }: { className?: string }) {
  const { preset, range, setPeriod, compare, setCompare, today, ready } = useApp();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<PickerRange | undefined>();
  const [showCalendar, setShowCalendar] = useState(false);

  const selected: PickerRange = draft ?? { from: parseISO(range.from), to: parseISO(range.to) };
  const calendarVisible = showCalendar || preset === "custom";

  const choose = (next: PeriodPreset) => {
    if (next === "custom") {
      setShowCalendar(true);
      return;
    }
    setDraft(undefined);
    setShowCalendar(false);
    setPeriod(next);
    setOpen(false);
  };

  const onSelect = (next: PickerRange | undefined) => {
    setDraft(next);
    if (next?.from && next.to) {
      setPeriod("custom", { from: format(next.from, ISO), to: format(next.to, ISO) });
      setDraft(undefined);
    }
  };

  const trigger = (
    <button
      type="button"
      disabled={!ready}
      className={cn(
        "inline-flex h-11 shrink-0 items-center gap-2 rounded-2xl border border-border bg-card px-3.5 text-sm font-medium shadow-card outline-none transition hover:shadow-lift focus-visible:ring-4 focus-visible:ring-brand/25 disabled:opacity-60 md:h-10",
        className,
      )}
    >
      <CalendarDays className="size-4 text-brand" />
      <span className="whitespace-nowrap">{t.period.presets[preset]}</span>
      <span className="hidden whitespace-nowrap text-muted-foreground lg:inline">{ready ? formatRange(range) : ""}</span>
      <ChevronDown className="size-4 text-subtle" />
    </button>
  );

  return (
    <Pop open={open} onOpenChange={setOpen} trigger={trigger} title={t.period.label}>
      <div className="flex flex-col gap-4 md:flex-row">
        <div className="grid grid-cols-2 gap-1.5 md:flex md:w-44 md:flex-col md:gap-1">
          {PERIOD_PRESETS.map((p) => {
            const active = p === "custom" ? calendarVisible : preset === p && !showCalendar;
            return (
              <button
                key={p}
                type="button"
                onClick={() => choose(p)}
                className={cn(
                  "flex min-h-11 items-center rounded-xl px-3.5 text-left text-sm font-medium outline-none transition focus-visible:ring-4 focus-visible:ring-brand/25 md:min-h-10",
                  active ? "bg-brand-soft text-accent-foreground" : "bg-muted/60 text-foreground hover:bg-muted md:bg-transparent",
                )}
              >
                {t.period.presets[p]}
              </button>
            );
          })}
        </div>

        {calendarVisible && (
          <div className="flex flex-col items-center border-border md:border-l md:pl-4">
            <Calendar
              mode="range"
              locale={ru}
              selected={selected}
              onSelect={onSelect}
              defaultMonth={selected.to ?? parseISO(today)}
              disabled={{ after: parseISO(today) }}
              className="p-0 [--cell-size:--spacing(10)] md:[--cell-size:--spacing(9)]"
            />
            <p className="mt-2 text-xs text-subtle">{t.period.customHint}</p>
          </div>
        )}
      </div>

      <label className="mt-4 flex min-h-11 cursor-pointer items-center justify-between gap-4 border-t border-border pt-3 text-sm">
        <span>{t.period.compare}</span>
        <Switch checked={compare} onCheckedChange={setCompare} />
      </label>
    </Pop>
  );
}
