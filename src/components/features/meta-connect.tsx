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
  INITIAL_SYNC_DAYS,
  metaAccounts,
  metaDisconnect,
  metaSelectAccounts,
  metaStart,
  runMetaSync,
  type MetaAccountOption,
} from "@/lib/meta-api";
import { useApp } from "@/lib/store";
import { getBrowserSupabase } from "@/lib/supabase/client";
import type { FnResult } from "@/lib/supabase/functions";
import type { AdConnection } from "@/lib/types";
import { cn } from "@/lib/utils";

const PERCENT = 100;
/** Параметры, с которыми Facebook возвращает браузер на страницу настроек. */
const RESULT_PARAM = "meta";
const DETAIL_PARAM = "detail";
/** Ошибки Meta держим на экране долго: их нужно успеть прочитать и переслать. */
const ERROR_TOAST = { duration: 60_000, closeButton: true };

type Connection = Pick<AdConnection, "status" | "userName">;
const errorText = (result: Extract<FnResult<unknown>, { ok: false }>) => result.detail ?? t.meta.errors[result.error] ?? t.common.genericError;

/**
 * Подключение Meta: вход через Facebook, выбор кабинетов и первая загрузка с прогрессом.
 * Платформа только читает рекламу; токен хранится на сервере зашифрованным.
 */
export function MetaConnection() {
  const s = t.meta;
  const { workspace, canManage, today, reloadData } = useApp();
  const [connection, setConnection] = useState<Connection | null>();
  const [pending, setPending] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [options, setOptions] = useState<MetaAccountOption[] | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [progress, setProgress] = useState<{ value: number; account: string } | null>(null);

  const loadConnection = useCallback(async () => {
    const { data } = await getBrowserSupabase()
      .from("ad_connections")
      .select("status, external_user_name")
      .eq("workspace_id", workspace.id)
      .eq("platform", "meta")
      .maybeSingle();
    setConnection(data && data.status !== "disconnected" ? { status: data.status, userName: data.external_user_name ?? "" } : null);
  }, [workspace.id]);

  const openPicker = useCallback(async () => {
    setPickerOpen(true);
    setOptions(null);
    const result = await metaAccounts(workspace.id);
    if (!result.ok) {
      toast.error(errorText(result), ERROR_TOAST);
      setPickerOpen(false);
      await loadConnection();
      return;
    }
    setOptions(result.data.accounts);
    setChosen(new Set(result.data.accounts.filter((a) => a.selected && a.supported).map((a) => a.externalId)));
  }, [workspace.id, loadConnection]);

  useEffect(() => {
    void loadConnection();
  }, [loadConnection]);

  // Возврат из окна Facebook: ?meta=connected или ?meta=error&detail=…
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const result = params.get(RESULT_PARAM);
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
    const result = await metaStart(workspace.id);
    if (result.ok) window.location.assign(result.data.url);
    else {
      toast.error(errorText(result), ERROR_TOAST);
      setPending(false);
    }
  };

  const disconnect = async () => {
    setPending(true);
    const result = await metaDisconnect(workspace.id);
    setPending(false);
    if (!result.ok) return void toast.error(errorText(result));
    toast.success(s.disconnected);
    await loadConnection();
  };

  const confirm = async () => {
    setPending(true);
    const selected = await metaSelectAccounts(workspace.id, [...chosen]);
    if (!selected.ok) {
      toast.error(errorText(selected), ERROR_TOAST);
      setPending(false);
      return;
    }
    setProgress({ value: 0, account: "" });
    const result = await runMetaSync(workspace.id, selected.data.accounts, today, INITIAL_SYNC_DAYS, (value, account) => setProgress({ value, account }));
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

  if (connection === undefined) return null;
  if (!canManage) return <p className="text-sm text-muted-foreground">{s.ownerOnly}</p>;

  const expired = connection?.status === "token_expired";
  return (
    <>
      {connection ? (
        <div className={cn("flex flex-col gap-3 rounded-[20px] border p-4 sm:flex-row sm:items-center", expired ? "border-warning/40 bg-warning/5" : "border-border")}>
          <PlatformIcon platform="meta" size="lg" />
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
          <PlatformIcon platform="meta" size="sm" />
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
