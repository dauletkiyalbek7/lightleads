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
