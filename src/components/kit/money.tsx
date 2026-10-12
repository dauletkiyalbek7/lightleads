"use client";

import { Info } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { t } from "@/i18n";
import { otherCurrency, rateOn } from "@/lib/currency";
import { formatDate } from "@/lib/dates";
import { formatMoney, formatNumber } from "@/lib/format";
import { useApp } from "@/lib/store";
import type { Currency, Dual } from "@/lib/types";
import { cn } from "@/lib/utils";

interface MoneyProps {
  value: Dual | null;
  /** По умолчанию — валюта отображения из переключателя «Показать в». */
  primary?: Currency;
  align?: "left" | "right";
  round?: boolean;
  className?: string;
  primaryClassName?: string;
  hideSecondary?: boolean;
}

/**
 * Денежная сумма в двух валютах: основная и под ней тонкий мелкий серый текст
 * со второй валютой — `$1 240.50` и `≈ 632 655 ₸`.
 */
export function Money({ value, primary, align = "left", round, className, primaryClassName, hideSecondary }: MoneyProps) {
  const { currency } = useApp();
  const main = primary ?? currency;
  const second = otherCurrency(main);
  return (
    <span className={cn("inline-flex flex-col leading-tight", align === "right" && "items-end text-right", className)}>
      <span className={cn("num font-semibold whitespace-nowrap", primaryClassName)}>
        {formatMoney(value ? value[main] : null, main, { round })}
      </span>
      {!hideSecondary && value && (
        <SecondaryMoney value={value[second]} currency={second} />
      )}
    </span>
  );
}

export function SecondaryMoney({ value, currency, className }: { value: number; currency: Currency; className?: string }) {
  return (
    <span className={cn("num mt-0.5 text-[11px] leading-none font-light whitespace-nowrap text-subtle", className)}>
      {t.currency.approx} {formatMoney(value, currency, { round: true })}
    </span>
  );
}

const RATE_DIGITS = 2;

/** Иконка-подсказка: «Курс НБРК на 12.10.2026: 1 USD = 510.20 ₸». */
export function RateTip({ date, className }: { date?: string; className?: string }) {
  const { ds, range } = useApp();
  const { rate, date: rateDate } = rateOn(ds.rates, date ?? range.to);
  const text = t.currency.rateHint({ date: formatDate(rateDate), rate: formatNumber(rate, RATE_DIGITS) });
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={text}
          className={cn(
            "relative inline-flex size-5 items-center justify-center rounded-full text-subtle before:absolute before:-inset-3 before:content-[''] hover:text-brand",
            className,
          )}
        >
          <Info className="size-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-64 flex-col items-start gap-1 rounded-xl px-3 py-2 text-left leading-snug">
        <span className="font-medium">{text}</span>
        {!date && <span className="opacity-70">{t.currency.rateNote}</span>}
      </TooltipContent>
    </Tooltip>
  );
}
