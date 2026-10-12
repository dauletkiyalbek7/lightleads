"use client";

import { motion } from "framer-motion";
import { Ellipsis, Plus } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Pill } from "@/components/kit/pills";
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { t } from "@/i18n";
import { useApp } from "@/lib/store";
import { cn } from "@/lib/utils";
import { BOTTOM_NAV_KEYS, isActive, NAV } from "./nav";
import { SyncStatus } from "./sync-status";

const ITEM =
  "relative flex min-h-14 flex-1 flex-col items-center justify-center gap-1 text-[11px] font-medium outline-none transition-colors";

/** Телефон: нижняя навигация из 5 пунктов и плавающая кнопка «+ Продажа». */
export function BottomNav() {
  const pathname = usePathname();
  const { setSaleDialogOpen } = useApp();
  const [moreOpen, setMoreOpen] = useState(false);

  const main = NAV.filter((n) => BOTTOM_NAV_KEYS.includes(n.key));
  const rest = NAV.filter((n) => !BOTTOM_NAV_KEYS.includes(n.key));
  const moreActive = rest.some((n) => isActive(pathname, n.href));

  return (
    <>
      <motion.button
        type="button"
        onClick={() => setSaleDialogOpen(true)}
        whileTap={{ scale: 0.94 }}
        initial={{ scale: 0, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: "spring", stiffness: 380, damping: 24, delay: 0.25 }}
        className="btn-shimmer fixed right-4 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-40 inline-flex h-14 items-center gap-2 rounded-full pr-5 pl-4 text-[15px] font-semibold text-white shadow-brand-lg outline-none focus-visible:ring-4 focus-visible:ring-brand/30 md:hidden"
      >
        <Plus className="size-6" strokeWidth={2.4} />
        {t.nav.addSale}
      </motion.button>

      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden">
        <div className="flex items-stretch px-1">
          {main.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <Link
                key={item.key}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(ITEM, active ? "text-brand" : "text-muted-foreground")}
              >
                {active && (
                  <motion.span
                    layoutId="bottom-nav-active"
                    className="bg-brand-gradient absolute top-0 h-[3px] w-8 rounded-b-full"
                    transition={{ type: "spring", stiffness: 480, damping: 38 }}
                  />
                )}
                <item.icon className="size-[22px]" />
                {t.nav[item.key]}
              </Link>
            );
          })}
          <button type="button" onClick={() => setMoreOpen(true)} className={cn(ITEM, moreActive ? "text-brand" : "text-muted-foreground")}>
            {moreActive && <span className="bg-brand-gradient absolute top-0 h-[3px] w-8 rounded-b-full" />}
            <Ellipsis className="size-[22px]" />
            {t.nav.more}
          </button>
        </div>
      </nav>

      <Drawer open={moreOpen} onOpenChange={setMoreOpen}>
        <DrawerContent className="rounded-t-[28px] border-0 bg-card">
          <DrawerHeader className="flex-row items-center justify-between px-5 pt-4 pb-2 text-left">
            <DrawerTitle className="font-display text-lg font-semibold tracking-tight">{t.nav.more}</DrawerTitle>
            <DrawerDescription className="sr-only">{t.nav.more}</DrawerDescription>
            <Pill tone="brand">{t.common.demo}</Pill>
          </DrawerHeader>
          <div className="space-y-1 px-3 pb-[max(env(safe-area-inset-bottom),1rem)]">
            {rest.map((item) => {
              const active = isActive(pathname, item.href);
              return (
                <Link
                  key={item.key}
                  href={item.href}
                  onClick={() => setMoreOpen(false)}
                  className={cn(
                    "flex min-h-13 items-center gap-3 rounded-2xl px-3.5 text-[15px] font-medium",
                    active ? "bg-brand-soft text-accent-foreground" : "text-foreground active:bg-muted",
                  )}
                >
                  <item.icon className={cn("size-5", active ? "text-brand" : "text-muted-foreground")} />
                  {t.nav[item.key]}
                </Link>
              );
            })}
            <div className="border-t border-border pt-1">
              <SyncStatus />
            </div>
          </div>
        </DrawerContent>
      </Drawer>
    </>
  );
}
