"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { SaleDialog } from "@/components/features/sale-dialog";
import { t } from "@/i18n";
import { useMediaQuery } from "@/hooks/use-media-query";
import { useApp } from "@/lib/store";
import { cn } from "@/lib/utils";
import { BottomNav } from "./bottom-nav";
import { currentNav } from "./nav";
import { Sidebar, SIDEBAR_OFFSET, type SidebarMode } from "./sidebar";
import { Topbar } from "./topbar";

const DESKTOP_QUERY = "(min-width: 1024px)";

/**
 * Каркас приложения.
 * Телефон: верхняя панель + нижняя навигация + плавающая «+ Продажа».
 * Планшет: сворачиваемый сайдбар. Десктоп: сайдбар слева.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { demoMode, workspace, salesPending, isEmpty } = useApp();
  const isDesktop = useMediaQuery(DESKTOP_QUERY);
  const [mode, setMode] = useState<SidebarMode>("auto");
  const nav = currentNav(pathname);

  const toggle = () => {
    const expanded = mode === "expanded" || (mode === "auto" && isDesktop);
    setMode(expanded ? "collapsed" : "expanded");
  };

  return (
    <div className="min-h-dvh bg-background">
      <Sidebar mode={mode} onToggle={toggle} />
      <div className={cn("transition-[padding] duration-300", SIDEBAR_OFFSET[mode])}>
        <Topbar />
        <main className="mx-auto max-w-[1480px] px-4 pt-1 pb-40 md:px-6 md:pt-2 md:pb-12 lg:px-8">
          {nav && (
            <div className="mb-4 md:hidden">
              <h1 className="font-display text-[22px] leading-tight font-semibold tracking-tight">{t.nav[nav.key]}</h1>
              <p className="mt-1 text-[13px] text-muted-foreground">{t.pageSubtitle[nav.key]}</p>
            </div>
          )}
          {!demoMode && workspace.demoData && (
            <p className="mb-4 rounded-2xl border border-border bg-card px-4 py-3 text-[13px] leading-relaxed text-muted-foreground">
              {t.common.demoDataNote}{" "}
              <Link href="/settings" className="font-semibold text-brand hover:underline">
                {t.common.demoDataAction}
              </Link>
            </p>
          )}
          {salesPending && !isEmpty && (
            <p className="mb-4 rounded-2xl border border-border bg-card px-4 py-3 text-[13px] leading-relaxed text-muted-foreground">{t.common.salesPendingNote}</p>
          )}
          {children}
        </main>
      </div>
      <BottomNav />
      <SaleDialog />
    </div>
  );
}
