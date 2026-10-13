"use client";

import { ClipboardList, MessageCircle, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Btn } from "@/components/kit/btn";
import { Modal } from "@/components/kit/overlay";
import { Pill } from "@/components/kit/pills";
import { IconPill, Section } from "@/components/kit/surface";
import { Checkbox } from "@/components/ui/checkbox";
import { t } from "@/i18n";
import { sinceLabel } from "@/lib/labels";
import {
  CHANNEL_KINDS,
  hasChannelAccess,
  metaLeadsOptions,
  metaLeadsSelect,
  metaLeadsStart,
  OAUTH_RETURN_KEY,
  OAUTH_RETURN_LEADS,
  type ChannelKind,
  type ChannelOption,
} from "@/lib/meta-leads-api";
import { useApp } from "@/lib/store";
import { getBrowserSupabase } from "@/lib/supabase/client";
import type { FnResult } from "@/lib/supabase/functions";
import { cn } from "@/lib/utils";

/** Ошибки Meta держим на экране долго: их нужно успеть прочитать и переслать. */
const ERROR_TOAST = { duration: 60_000, closeButton: true };
const ICONS = { meta_page: ClipboardList, whatsapp: MessageCircle } as const;

interface Connection {
  status: string;
  scopes: string[];
}

interface Channel {
  id: string;
  kind: ChannelKind;
  name: string;
  detail: string;
  status: "active" | "error";
  error: string | null;
  last_lead_at: string | null;
}

type Failure = Extract<FnResult<unknown>, { ok: false }>;

/** Текст ошибки: наш перевод кода, иначе пояснение самой Meta. */
const errorText = (result: Failure) => {
  const s = t.leadChannels;
  if (result.error === "scope_missing") return s.scopeMissing;
  if (result.error === "platform_error" && result.detail) return result.detail;
  return s.errors[result.error] ?? result.detail ?? t.common.genericError;
};

/**
 * Источники лидов внутри Meta: лид-формы страниц Facebook и номера WhatsApp (Cloud API).
 * Владелец выдаёт LightLeads дополнительные права Facebook и выбирает страницы и номера этой компании.
 */
export function MetaLeadChannels() {
  const { workspace } = useApp();
  /** undefined — ещё загружаем; null — Meta не подключена. */
  const [connection, setConnection] = useState<Connection | null>();
  const [channels, setChannels] = useState<Channel[]>([]);

  const load = useCallback(async () => {
    const supabase = getBrowserSupabase();
    const [meta, saved] = await Promise.all([
      supabase.from("ad_connections").select("status, scopes").eq("workspace_id", workspace.id).eq("platform", "meta").maybeSingle<Connection>(),
      supabase.from("lead_channels").select("id, kind, name, detail, status, error, last_lead_at").eq("workspace_id", workspace.id).order("created_at").returns<Channel[]>(),
    ]);
    setConnection(meta.data && meta.data.status !== "disconnected" ? meta.data : null);
    setChannels(saved.data ?? []);
  }, [workspace.id]);

  useEffect(() => {
    setConnection(undefined);
    void load();
  }, [load]);

  return (
    <div className="grid gap-4 md:gap-6 lg:grid-cols-2">
      {CHANNEL_KINDS.map((kind) => (
        <ChannelCard key={kind} kind={kind} connection={connection} channels={channels.filter((channel) => channel.kind === kind)} onChanged={load} />
      ))}
    </div>
  );
}

interface CardProps {
  kind: ChannelKind;
  connection: Connection | null | undefined;
  channels: Channel[];
  onChanged: () => Promise<void>;
}

function ChannelCard({ kind, connection, channels, onChanged }: CardProps) {
  const s = t.leadChannels;
  const text = s[kind];
  const { workspace, canManage, reloadData } = useApp();
  const [pending, setPending] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [options, setOptions] = useState<ChannelOption[] | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const Icon = ICONS[kind];
  const granted = connection ? hasChannelAccess(kind, connection.scopes) : false;

  const grant = async () => {
    setPending(true);
    const result = await metaLeadsStart(workspace.id, kind);
    if (!result.ok) {
      toast.error(errorText(result), ERROR_TOAST);
      setPending(false);
      return;
    }
    try {
      sessionStorage.setItem(OAUTH_RETURN_KEY, OAUTH_RETURN_LEADS);
    } catch {
      /* хранилище недоступно: после входа откроется вкладка «Подключения» */
    }
    window.location.assign(result.data.url);
  };

  const openPicker = async () => {
    setPickerOpen(true);
    setOptions(null);
    const result = await metaLeadsOptions(workspace.id, kind);
    if (!result.ok) {
      toast.error(errorText(result), ERROR_TOAST);
      setPickerOpen(false);
      return;
    }
    setOptions(result.data.options);
    setChosen(new Set(result.data.options.filter((option) => option.selected).map((option) => option.id)));
  };

  const save = async () => {
    setPending(true);
    const result = await metaLeadsSelect(workspace.id, kind, [...chosen]);
    setPending(false);
    if (!result.ok) return void toast.error(errorText(result), ERROR_TOAST);
    setPickerOpen(false);
    if (result.data.taken.length) toast.error(s.taken(result.data.taken.join(", ")), ERROR_TOAST);
    else toast.success(result.data.leads ? s.savedLeads(result.data.leads) : s.saved);
    await onChanged();
    // Прошлые заявки уже в базе: показываем их на экранах без перезагрузки страницы
    if (result.data.leads) await reloadData();
  };

  const toggle = (id: string) =>
    setChosen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <Section title={text.title} hint={text.hint}>
      {kind === "whatsapp" && (
        <div className="mb-4 flex gap-3 rounded-2xl border border-warning/30 bg-warning/8 p-4 text-sm leading-relaxed">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" />
          <p>{s.whatsapp.warning}</p>
        </div>
      )}

      {channels.length > 0 && (
        <ul className="mb-4 space-y-2">
          {channels.map((channel) => (
            <li key={channel.id} className="flex items-start gap-3 rounded-2xl bg-muted/60 p-3">
              <IconPill tone={channel.status === "error" ? "danger" : "success"}>
                <Icon />
              </IconPill>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{channel.name || channel.detail}</p>
                <p className="num text-xs text-muted-foreground">
                  {channel.name && channel.detail ? `${channel.detail} · ` : ""}
                  {channel.last_lead_at ? s.lastLead(sinceLabel(Date.parse(channel.last_lead_at))) : s.waiting}
                </p>
                {channel.error && <p className="mt-1 text-xs leading-relaxed text-danger">{channel.error}</p>}
              </div>
              <Pill tone={channel.status === "error" ? "danger" : "success"}>{channel.status === "error" ? s.error : s.active}</Pill>
            </li>
          ))}
        </ul>
      )}

      {connection === undefined ? (
        <p className="text-sm text-muted-foreground">{s.loading}</p>
      ) : connection === null ? (
        <p className="text-sm text-muted-foreground">{s.needMeta}</p>
      ) : connection.status === "token_expired" ? (
        <p className="text-sm text-muted-foreground">{s.expired}</p>
      ) : !canManage ? (
        channels.length === 0 && <p className="text-sm text-muted-foreground">{s.ownerOnly}</p>
      ) : granted ? (
        <div className="flex flex-wrap items-center gap-3">
          <Btn variant="soft" size="sm" onClick={() => void openPicker()} disabled={pending}>
            {text.choose}
          </Btn>
          {channels.length === 0 && <span className="text-sm text-muted-foreground">{text.empty}</span>}
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm leading-relaxed text-muted-foreground">{text.grantText}</p>
          <Btn variant="secondary" size="sm" onClick={() => void grant()} disabled={pending}>
            {s.grant}
          </Btn>
        </div>
      )}

      <Modal
        open={pickerOpen}
        onOpenChange={(open) => !pending && setPickerOpen(open)}
        title={text.pickerTitle}
        description={text.pickerText}
        footer={
          options !== null && (
            <Btn onClick={() => void save()} disabled={pending}>
              {t.common.save}
            </Btn>
          )
        }
      >
        {options === null ? (
          <p className="py-6 text-center text-sm text-muted-foreground">{s.pickerLoading}</p>
        ) : options.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">{text.pickerEmpty}</p>
        ) : (
          <ul className="space-y-2">
            {options.map((option) => (
              <li key={option.id}>
                <label
                  className={cn(
                    "flex min-h-16 items-center gap-3 rounded-2xl border border-border p-3 transition",
                    option.taken ? "opacity-60" : "cursor-pointer hover:border-brand/40",
                    chosen.has(option.id) && "border-brand bg-brand-soft/60",
                  )}
                >
                  <Checkbox checked={chosen.has(option.id)} onCheckedChange={() => toggle(option.id)} disabled={option.taken} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{option.name || option.detail}</span>
                    <span className="num block truncate text-xs text-muted-foreground">{option.taken ? s.takenNote : option.name && option.detail ? option.detail : option.id}</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </Modal>
    </Section>
  );
}
