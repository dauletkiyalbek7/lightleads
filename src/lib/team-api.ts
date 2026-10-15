import { callFunction, type FnResult } from "./supabase/functions";
import type { Credentials, Platform } from "./types";

/** Запросы к Edge Function `team` (supabase/functions/team): аккаунты, проекты и их состав. */
type TeamRequest =
  | { action: "create_workspace"; name: string; ownerEmail: string; ownerName: string }
  | { action: "create_project"; name: string }
  | { action: "create_user"; email: string; name: string }
  | { action: "overview" }
  | { action: "invite_member"; workspaceId: string; email: string; name: string }
  | { action: "remove_member"; workspaceId: string; userId: string }
  | { action: "reset_password"; userId: string }
  | { action: "delete_workspace"; workspaceId: string; confirmName: string };

export type TeamResult<T> = FnResult<T>;

export const callTeam = <T = Credentials>(body: TeamRequest) => callFunction<T>("team", body);

type Role = "owner" | "member";

/** Вся платформа глазами её владельца: люди, проекты и подключённая к проектам реклама. */
export interface PlatformOverview {
  /** За сколько последних дней посчитаны лиды и продажи. */
  days: number;
  people: {
    id: string;
    email: string;
    name: string;
    isAdmin: boolean;
    createdAt: string;
    lastSignInAt: string | null;
    projects: { id: string; role: Role }[];
  }[];
  projects: {
    id: string;
    name: string;
    createdAt: string;
    demo: boolean;
    members: { id: string; role: Role }[];
    /** Вход в рекламную платформу: через чей аккаунт подключена реклама проекта. */
    connections: { platform: Platform; status: string; userName: string; updatedAt: string }[];
    accounts: { platform: Platform; externalId: string; name: string; currency: string; selected: boolean; status: string; lastSyncedAt: string | null }[];
    channels: { kind: string; name: string; detail: string; status: string }[];
    leads: number;
    sales: number;
  }[];
}

export type OverviewProject = PlatformOverview["projects"][number];
export type OverviewPerson = PlatformOverview["people"][number];

/** Выбранный проект запоминается в браузере: после создания нового проекта открываем сразу его. */
export const WORKSPACE_STORAGE_KEY = "ll-workspace";

export function openProject(id: string, path = "/settings") {
  try {
    localStorage.setItem(WORKSPACE_STORAGE_KEY, id);
  } catch {
    /* хранилище недоступно: откроется первый проект из списка */
  }
  window.location.assign(path);
}
