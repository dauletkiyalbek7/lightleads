"use client";

import { RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { t } from "@/i18n";
import { sinceLabel } from "@/lib/labels";
import { useApp } from "@/lib/store";
import { cn } from "@/lib/utils";

const TICK_MS = 30_000;

/** «Обновлено 12 минут назад» + кнопка «Обновить сейчас». */
export function SyncStatus({ labelClassName, className }: { labelClassName?: string; className?: string }) {
  const { lastSyncedAt, syncing, syncNow, ready, isEmpty } = useApp();
  const [now, setNow] = useState(0);

  useEffect(() => {
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), TICK_MS);
    return () => window.clearInterval(id);
  }, [lastSyncedAt]);

  if (!ready || isEmpty) return null;

  const refresh = () => {
    if (syncing) return;
    syncNow();
    toast.success(t.sync.refreshed);
  };

  return (
    <button
      type="button"
      onClick={refresh}
      title={t.sync.refresh}
      className={cn(
        "flex min-h-11 w-full items-center gap-2.5 rounded-2xl p-1.5 text-left outline-none transition hover:bg-muted focus-visible:ring-4 focus-visible:ring-brand/25",
        className,
      )}
    >
      <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-[12px] bg-success/12 text-success">
        <RefreshCw className={cn("size-4", syncing && "animate-spin")} />
      </span>
      <span className={cn("min-w-0 flex-1", labelClassName)}>
        <span className="block truncate text-[13px] font-medium">
          {syncing ? t.sync.refreshing : t.sync.updatedAgo(sinceLabel(lastSyncedAt, now || lastSyncedAt))}
        </span>
        <span className="block truncate text-xs text-muted-foreground">{t.sync.refresh}</span>
      </span>
    </button>
  );
}
