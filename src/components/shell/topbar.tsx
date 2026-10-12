"use client";

import { LogOut, Plus, Settings } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogoMark } from "@/components/kit/brand";
import { Btn } from "@/components/kit/btn";
import { RateTip } from "@/components/kit/money";
import { Segmented } from "@/components/kit/segmented";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { t } from "@/i18n";
import { CURRENCY_SYMBOL } from "@/lib/format";
import { useApp } from "@/lib/store";
import type { Currency } from "@/lib/types";
import { cn } from "@/lib/utils";
import { currentNav } from "./nav";
import { PeriodPicker } from "./period-picker";
import { WorkspaceSwitcher } from "./workspace-switcher";

const CURRENCY_OPTIONS: { value: Currency; label: string }[] = [
  { value: "USD", label: `${CURRENCY_SYMBOL.USD} USD` },
  { value: "KZT", label: `${CURRENCY_SYMBOL.KZT} KZT` },
];

/** «Показать в: USD / KZT» — основная валюта; вторая выводится мелким серым под каждой суммой. */
export function CurrencyToggle({ className }: { className?: string }) {
  const { currency, setCurrency } = useApp();
  return (
    <div className={cn("flex shrink-0 items-center gap-1", className)} title={t.currency.showIn}>
      <Segmented value={currency} onChange={setCurrency} options={CURRENCY_OPTIONS} size="sm" className="h-11 md:h-10" />
      <RateTip />
    </div>
  );
}

function UserMenu() {
  const { members } = useApp();
  const me = members[0];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={t.nav.profile}
        className="bg-brand-gradient inline-flex size-10 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white outline-none transition hover:shadow-brand focus-visible:ring-4 focus-visible:ring-brand/25"
      >
        {me?.name[0] ?? "Д"}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={8} className="w-60 rounded-2xl p-1.5">
        <DropdownMenuLabel className="px-2">
          <span className="block text-sm font-semibold text-foreground">{me?.name}</span>
          <span className="block text-xs font-normal text-muted-foreground">{me?.email}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild className="min-h-10 gap-2 rounded-xl">
          <Link href="/settings">
            <Settings className="size-4" />
            {t.nav.settings}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild className="min-h-10 gap-2 rounded-xl">
          <Link href="/">
            <LogOut className="size-4" />
            {t.nav.logout}
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function Topbar() {
  const pathname = usePathname();
  const { setSaleDialogOpen } = useApp();
  const nav = currentNav(pathname);

  return (
    <header className="sticky top-0 z-30 bg-background/85 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-[1480px] items-center gap-3 px-4 md:px-6 lg:px-8">
        {/* Телефон: логотип и переключатель workspace */}
        <div className="flex min-w-0 flex-1 items-center gap-2 md:hidden">
          <Link href="/dashboard" aria-label={t.common.appName}>
            <LogoMark />
          </Link>
          <WorkspaceSwitcher className="w-auto min-w-0" />
        </div>

        {/* Планшет и десктоп: заголовок страницы */}
        <div className="hidden min-w-0 flex-1 md:block">
          <h1 className="font-display truncate text-xl font-semibold tracking-tight">{nav ? t.nav[nav.key] : t.common.appName}</h1>
          {nav && <p className="hidden truncate text-[13px] text-muted-foreground xl:block">{t.pageSubtitle[nav.key]}</p>}
        </div>

        <div className="hidden items-center gap-2 md:flex">
          <PeriodPicker />
          <CurrencyToggle />
          <Btn size="sm" className="h-10 rounded-2xl px-3 lg:px-4" aria-label={t.nav.addSale} onClick={() => setSaleDialogOpen(true)}>
            <Plus />
            <span className="hidden lg:inline">{t.nav.addSale}</span>
          </Btn>
        </div>
        <UserMenu />
      </div>

      {/* Телефон: вторая строка с периодом и валютой, прокручивается по горизонтали */}
      <div className="no-scrollbar flex items-center gap-2 overflow-x-auto px-4 pb-3 md:hidden">
        <PeriodPicker />
        <CurrencyToggle />
      </div>
    </header>
  );
}
