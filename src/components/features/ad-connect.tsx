"use client";

import { RefreshCw, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { PlatformIcon } from "@/components/kit/brand";
import { Btn } from "@/components/kit/btn";
import { Modal } from "@/components/kit/overlay";
import { Pill } from "@/components/kit/pills";
import { Checkbox } from "@/components/ui/checkbox";
import { t } from "@/i18n";
import { celebrate } from "@/lib/confetti";
import {
  adErrorText,
  adsAccounts,
  adsConfigured,
  adsDisconnect,
  adsSelectAccounts,
  adsStart,
  INITIAL_SYNC_DAYS,
  runAdSync,
  type AdAccountOption,
} from "@/lib/ads-api";
import { useApp } from "@/lib/store";
import { getBrowserSupabase } from "@/lib/supabase/client";
import type { FnResult } from "@/lib/supabase/functions";
import type { AdConnection, Platform } from "@/lib/types";
import { cn } from "@/lib/utils";

const PERCENT = 100;
/** Вместе с параметром-названием платформы (?meta=…, ?tiktok=…) приходит пояснение ошибки. */
const DETAIL_PARAM = "detail";
/** Ошибки платформ держим на экране долго: их нужно успеть прочитать и переслать. */
const ERROR_TOAST = { duration: 60_000, closeButton: true };

type Connection = Pick<AdConnection, "status" | "userName">;
type Failure = Extract<FnResult<unknown>, { ok: false }>;

/**
 * Подключение рекламной платформы: вход на её стороне, выбор кабинетов и первая загрузка с прогрессом.
 * LightLeads только читает рекламу; токен хранится на сервере зашифрованным.
 */
export function AdPlatformConnection({ platform }: { platform: Platform }) {
  const s = { ...t.ads, ...t.ads[platform] };
  const { workspace, canManage, today, reloadData } = useApp();
  const errorText = (result: Failure) => adErrorText(platform, result);
  const [connection, setConnection] = useState<Connection | null>();
  /** undefined — ещё проверяем; false — на сервере нет ключей приложения платформы. */
  const [configured, setConfigured] = useState<boolean>();
  const [pending, setPending] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [options, setOptions] = useState<AdAccountOption[] | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [progress, setProgress] = useState<{ value: number; account: string } | null>(null);

  const loadConnection = useCallback(async () => {
    const { data } = await getBrowserSupabase()
      .from("ad_connections")
      .select("status, external_user_name")
      .eq("workspace_id", workspace.id)
      .eq("platform", platform)
      .maybeSingle();
    setConnection(data && data.status !== "disconnected" ? { status: data.status, userName: data.external_user_name ?? "" } : null);
  }, [workspace.id, platform]);

  const openPicker = useCallback(async () => {
    setPickerOpen(true);
    setOptions(null);
    const result = await adsAccounts(platform, workspace.id);
    if (!result.ok) {
      toast.error(adErrorText(platform, result), ERROR_TOAST);
      setPickerOpen(false);
      await loadConnection();
      return;
    }
    setOptions(result.data.accounts);
    setChosen(new Set(result.data.accounts.filter((a) => a.selected && a.supported).map((a) => a.externalId)));
  }, [workspace.id, platform, loadConnection]);

  useEffect(() => {
    void loadConnection();
  }, [loadConnection]);

  useEffect(() => {
    void adsConfigured(platform).then(setConfigured);
  }, [platform]);

  // Возврат из окна входа платформы: ?meta=connected или ?tiktok=error&detail=…
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const result = params.get(platform);
    if (!result) return;
    window.history.replaceState(null, "", window.location.pathname);
    if (result === "connected") {
      toast.success(s.connected);
      void openPicker();
    } else {
      toast.error(params.get(DETAIL_PARAM) ?? t.common.genericError, ERROR_TOAST);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- один раз при открытии страницы
  }, []);

  const connect = async () => {
    setPending(true);
    const result = await adsStart(platform, workspace.id);
    if (result.ok) window.location.assign(result.data.url);
    else {
      toast.error(errorText(result), ERROR_TOAST);
      setPending(false);
    }
  };

  const disconnect = async () => {
    setPending(true);
    const result = await adsDisconnect(platform, workspace.id);
    setPending(false);
    if (!result.ok) return void toast.error(errorText(result));
    toast.success(s.disconnected);
    await loadConnection();
  };

  const confirm = async () => {
    setPending(true);
    const selected = await adsSelectAccounts(platform, workspace.id, [...chosen]);
    if (!selected.ok) {
      toast.error(errorText(selected), ERROR_TOAST);
      setPending(false);
      return;
    }
    setProgress({ value: 0, account: "" });
    const result = await runAdSync(platform, workspace.id, selected.data.accounts, today, "initial", (value, account) => setProgress({ value, account }));
    await reloadData();
    setProgress(null);
    setPending(false);
    setPickerOpen(false);
    if (result.ok) {
      toast.success(s.syncDone);
      celebrate();
    } else {
      toast.error(`${s.syncFailed}: ${errorText(result)}`, ERROR_TOAST);
    }
  };

  const toggle = (id: string) =>
    setChosen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // Подключением управляет владелец workspace: остальным о нём говорит подпись на странице настроек
  if (!canManage || connection === undefined || configured === undefined) return null;
  // Пока на сервере нет ключей приложения платформы, подключение показываем как «Скоро»
  if (!connection && !configured) {
    return (
      <Btn variant="secondary" disabled>
        <PlatformIcon platform={platform} size="sm" />
        {s.connect}
        <Pill tone="muted">{t.common.soon}</Pill>
      </Btn>
    );
  }

  const expired = connection?.status === "token_expired";
  return (
    <>
      {connection ? (
        <div className={cn("flex w-full flex-col gap-3 rounded-[20px] border p-4 sm:flex-row sm:items-center", expired ? "border-warning/40 bg-warning/5" : "border-border")}>
          <PlatformIcon platform={platform} size="lg" />
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold">{s.connectedAs(connection.userName)}</p>
            <p className="text-sm text-muted-foreground">{expired ? s.expired : s.connectedHint}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {expired ? (
              <Btn size="sm" onClick={connect} disabled={pending}>
                <TriangleAlert />
                {s.reconnect}
              </Btn>
            ) : (
              <Btn variant="soft" size="sm" onClick={() => void openPicker()} disabled={pending}>
                {s.chooseAccounts}
              </Btn>
            )}
            <Btn variant="ghost" size="sm" className="text-danger hover:bg-danger/10 hover:text-danger" onClick={disconnect} disabled={pending}>
              {s.disconnect}
            </Btn>
          </div>
        </div>
      ) : (
        <Btn variant="secondary" onClick={connect} disabled={pending}>
          <PlatformIcon platform={platform} size="sm" />
          {s.connect}
        </Btn>
      )}

      <Modal
        open={pickerOpen}
        // Во время загрузки окно не закрываем: синхронизация идёт из этой вкладки
        onOpenChange={(open) => !progress && setPickerOpen(open)}
        title={progress ? s.syncTitle : s.pickerTitle}
        description={progress ? s.syncText(INITIAL_SYNC_DAYS) : s.pickerText}
        footer={
          !progress && (
            <Btn onClick={confirm} disabled={pending || chosen.size === 0}>
              {s.pickerConfirm(chosen.size)}
            </Btn>
          )
        }
      >
        {progress ? (
          <div className="space-y-3 py-2">
            <div className="h-2.5 overflow-hidden rounded-full bg-muted">
              <div className="bg-brand-gradient h-full rounded-full transition-[width] duration-500" style={{ width: `${Math.round(progress.value * PERCENT)}%` }} />
            </div>
            <p className="num flex items-center gap-2 text-sm text-muted-foreground">
              <RefreshCw className="size-4 animate-spin" />
              {Math.round(progress.value * PERCENT)}%{progress.account && ` · ${progress.account}`}
            </p>
          </div>
        ) : options === null ? (
          <p className="py-6 text-center text-sm text-muted-foreground">{s.pickerLoading}</p>
        ) : options.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">{s.pickerEmpty}</p>
        ) : (
          <ul className="space-y-2">
            {options.map((account) => (
              <li key={account.externalId}>
                <label
                  className={cn(
                    "flex min-h-16 items-center gap-3 rounded-2xl border border-border p-3 transition",
                    account.supported ? "cursor-pointer hover:border-brand/40" : "opacity-60",
                    chosen.has(account.externalId) && "border-brand bg-brand-soft/60",
                  )}
                >
                  <Checkbox checked={chosen.has(account.externalId)} onCheckedChange={() => toggle(account.externalId)} disabled={!account.supported} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{account.name}</span>
                    <span className="num block truncate text-xs text-muted-foreground">
                      {account.supported ? `${account.externalId} · ${account.currency} · ${account.timezone}` : s.unsupported}
                    </span>
                  </span>
                  {!account.active && <Pill tone="warning">{s.inactive}</Pill>}
                </label>
              </li>
            ))}
          </ul>
        )}
      </Modal>
    </>
  );
}
