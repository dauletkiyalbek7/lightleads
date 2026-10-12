"use client";

import { motion } from "framer-motion";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Logo } from "@/components/kit/brand";
import { Pill } from "@/components/kit/pills";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { t } from "@/i18n";
import { APP } from "@/lib/config";
import { useApp } from "@/lib/store";
import { cn } from "@/lib/utils";
import { isActive, NAV } from "./nav";
import { SyncStatus } from "./sync-status";
import { WorkspaceSwitcher } from "./workspace-switcher";

/** auto — свёрнут на планшете, развёрнут на десктопе; дальше пользователь решает сам. */
export type SidebarMode = "auto" | "collapsed" | "expanded";

export const SIDEBAR_WIDTH: Record<SidebarMode, string> = {
  auto: "md:w-[76px] lg:w-[264px]",
  collapsed: "md:w-[76px]",
  expanded: "md:w-[264px]",
};
export const SIDEBAR_OFFSET: Record<SidebarMode, string> = {
  auto: "md:pl-[76px] lg:pl-[264px]",
  collapsed: "md:pl-[76px]",
  expanded: "md:pl-[264px]",
};
/** Подписи видны только в развёрнутом состоянии. */
const LABEL: Record<SidebarMode, string> = { auto: "hidden lg:block", collapsed: "hidden", expanded: "block" };
const LABEL_INLINE: Record<SidebarMode, string> = { auto: "hidden lg:inline-flex", collapsed: "hidden", expanded: "inline-flex" };
const COLLAPSED_ONLY: Record<SidebarMode, string> = { auto: "lg:hidden", collapsed: "", expanded: "hidden" };

export function Sidebar({ mode, onToggle }: { mode: SidebarMode; onToggle: () => void }) {
  const pathname = usePathname();
  const { demoMode, workspace } = useApp();
  const label = LABEL[mode];

  return (
    <aside
      className={cn(
        "fixed inset-y-0 left-0 z-40 hidden flex-col border-r border-border bg-card transition-[width] duration-300 md:flex",
        SIDEBAR_WIDTH[mode],
      )}
    >
      <div className="flex h-16 shrink-0 items-center justify-between gap-2 px-5">
        <Link href="/dashboard" className="rounded-xl outline-none focus-visible:ring-4 focus-visible:ring-brand/25" aria-label={APP.name}>
          <Logo compact className={cn(COLLAPSED_ONLY[mode])} />
          <Logo className={LABEL_INLINE[mode]} />
        </Link>
      </div>

      <div className="px-3.5">
        <WorkspaceSwitcher labelClassName={label} className="justify-center" />
      </div>

      <nav className="mt-4 flex flex-1 flex-col gap-1 overflow-y-auto px-3.5">
        {NAV.map((item) => {
          const active = isActive(pathname, item.href);
          const link = (
            <Link
              key={item.key}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "relative flex min-h-11 items-center gap-3 rounded-2xl px-3.5 text-sm font-medium outline-none transition-colors focus-visible:ring-4 focus-visible:ring-brand/25",
                active ? "text-accent-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              {active && (
                <motion.span
                  layoutId="sidebar-active"
                  className="absolute inset-0 rounded-2xl bg-brand-soft"
                  transition={{ type: "spring", stiffness: 460, damping: 38 }}
                />
              )}
              <item.icon className={cn("relative size-5 shrink-0", active && "text-brand")} />
              <span className={cn("relative truncate", label)}>{t.nav[item.key]}</span>
            </Link>
          );
          return (
            <Tooltip key={item.key}>
              <TooltipTrigger asChild>{link}</TooltipTrigger>
              <TooltipContent side="right" sideOffset={10} className={cn("rounded-lg", COLLAPSED_ONLY[mode])}>
                {t.nav[item.key]}
              </TooltipContent>
            </Tooltip>
          );
        })}
      </nav>

      <div className="space-y-1 border-t border-border p-3.5">
        <SyncStatus labelClassName={label} className="justify-center" />
        <div className="flex items-center justify-between gap-2 pl-1.5">
          {demoMode || workspace.demoData ? (
            <Pill tone="brand" className={LABEL_INLINE[mode]}>
              {demoMode ? t.common.demo : t.common.demoData}
            </Pill>
          ) : (
            <span />
          )}
          <button
            type="button"
            onClick={onToggle}
            aria-label={mode === "expanded" ? t.nav.collapse : t.nav.expand}
            className="inline-flex size-9 items-center justify-center rounded-xl text-muted-foreground outline-none transition hover:bg-muted hover:text-foreground focus-visible:ring-4 focus-visible:ring-brand/25"
          >
            <PanelLeftOpen className={cn("size-[18px]", COLLAPSED_ONLY[mode])} />
            <PanelLeftClose className={cn("size-[18px]", label)} />
          </button>
        </div>
      </div>
    </aside>
  );
}
