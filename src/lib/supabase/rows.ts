import type { Member, Workspace, WorkspaceSettings } from "@/lib/types";

/** Строка таблицы workspaces (только поля, которые читает приложение). */
export interface WorkspaceRow {
  id: string;
  name: string;
  timezone: string;
  sales_currency: WorkspaceSettings["salesCurrency"];
  margin_pct: number;
  target_cac: number | null;
  target_romi: number | null;
  attribution_model: WorkspaceSettings["attributionModel"];
  attribution_window: WorkspaceSettings["attributionWindow"];
  demo_data: boolean;
  created_at: string;
}

export interface ProfileRow {
  id: string;
  full_name: string;
  email: string;
}

export interface MemberRow {
  role: Member["role"];
  profiles: ProfileRow | null;
}

export const WORKSPACE_COLUMNS =
  "id, name, timezone, sales_currency, margin_pct, target_cac, target_romi, attribution_model, attribution_window, demo_data, created_at";

export function rowToWorkspace(row: WorkspaceRow, role: Workspace["role"]): Workspace {
  return {
    id: row.id,
    name: row.name,
    role,
    timezone: row.timezone,
    demoData: row.demo_data,
    settings: {
      salesCurrency: row.sales_currency,
      marginPct: Number(row.margin_pct),
      targetCac: row.target_cac === null ? null : Number(row.target_cac),
      targetRomi: row.target_romi === null ? null : Number(row.target_romi),
      attributionModel: row.attribution_model,
      attributionWindow: row.attribution_window,
    },
  };
}

/** Настройки workspace → колонки таблицы. */
export function settingsToRow(patch: Partial<WorkspaceSettings>): Partial<WorkspaceRow> {
  const row: Partial<WorkspaceRow> = {};
  if (patch.salesCurrency !== undefined) row.sales_currency = patch.salesCurrency;
  if (patch.marginPct !== undefined) row.margin_pct = patch.marginPct;
  if (patch.targetCac !== undefined) row.target_cac = patch.targetCac;
  if (patch.targetRomi !== undefined) row.target_romi = patch.targetRomi;
  if (patch.attributionModel !== undefined) row.attribution_model = patch.attributionModel;
  if (patch.attributionWindow !== undefined) row.attribution_window = patch.attributionWindow;
  return row;
}

export function rowToMember(row: MemberRow): Member | null {
  if (!row.profiles) return null;
  const { id, full_name, email } = row.profiles;
  return { id, name: full_name || email.split("@")[0], email, role: row.role, status: "active" };
}
