import { getBrowserSupabase } from "./supabase/client";
import { callFunction } from "./supabase/functions";
import type { LeadRow } from "./supabase/dataset";

/** Запросы к Edge Function `leads` (supabase/functions/leads): ручной лид и удаление лида. */
const FUNCTION = "leads";

export interface ManualLeadInput {
  phone: string;
  name: string;
  /** Объявление, которое менеджер выбрал источником; null — источник неизвестен. */
  adId: string | null;
}

export const leadsAdd = (workspaceId: string, input: ManualLeadInput) =>
  callFunction<{ lead: LeadRow }>(FUNCTION, { action: "add", workspaceId, ...input });

export const leadsDelete = (workspaceId: string, leadId: string) => callFunction<{ ok: boolean }>(FUNCTION, { action: "delete", workspaceId, leadId });

/** Подробности заявки для карточки лида: их нет в общем наборе, чтобы не грузить сырые заявки всех лидов. */
export interface LeadDetails {
  /** Поля заявки как они пришли: форма сайта, лид-форма Meta, сообщение WhatsApp. */
  payload: Record<string, unknown>;
  utm: Record<string, string>;
  /** Страница Facebook или номер WhatsApp, на который пришла заявка. */
  channel: { kind: "meta_page" | "whatsapp"; name: string; detail: string } | null;
}

export async function leadDetails(id: string): Promise<LeadDetails | null> {
  const supabase = getBrowserSupabase();
  const { data, error } = await supabase.from("leads").select("workspace_id, raw_payload, utm").eq("id", id).maybeSingle();
  if (error || !data) return null;
  const payload = (data.raw_payload ?? {}) as Record<string, unknown>;
  const channelId = String(payload.phone_number_id ?? payload.page_id ?? "");
  const { data: channel } = channelId
    ? await supabase.from("lead_channels").select("kind, name, detail").eq("workspace_id", data.workspace_id).eq("external_id", channelId).maybeSingle()
    : { data: null };
  return { payload, utm: (data.utm ?? {}) as Record<string, string>, channel: channel as LeadDetails["channel"] };
}

/** Комментарий менеджера к лиду. Остальные поля лида браузеру менять нельзя (см. миграцию 0012). */
export async function leadSetNote(id: string, note: string): Promise<boolean> {
  const { data, error } = await getBrowserSupabase().from("leads").update({ note }).eq("id", id).select("id");
  return !error && (data?.length ?? 0) > 0;
}
