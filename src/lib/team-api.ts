import { callFunction, type FnResult } from "./supabase/functions";
import type { Credentials } from "./types";

/** Запросы к Edge Function `team` (supabase/functions/team): аккаунты и состав workspace. */
type TeamRequest =
  | { action: "create_workspace"; name: string; ownerEmail: string; ownerName: string }
  | { action: "invite_member"; workspaceId: string; email: string; name: string }
  | { action: "remove_member"; workspaceId: string; userId: string }
  | { action: "reset_password"; userId: string }
  | { action: "delete_workspace"; workspaceId: string; confirmName: string };

export type TeamResult<T> = FnResult<T>;

export const callTeam = <T = Credentials>(body: TeamRequest) => callFunction<T>("team", body);
