import type { SessionContext } from "@/lib/types";
import { isSupabaseConfigured } from "./env";
import { rowToWorkspace, WORKSPACE_COLUMNS, type WorkspaceRow } from "./rows";
import { createServerSupabase } from "./server";

interface MembershipRow {
  role: "owner" | "member";
  workspaces: WorkspaceRow | null;
}

/** Кто вошёл и в каких workspace он состоит. null — гость: ему показываем демо. */
export async function getSessionContext(): Promise<SessionContext | null> {
  if (!isSupabaseConfigured) return null;
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const [profile, memberships] = await Promise.all([
    supabase.from("profiles").select("full_name, email, is_platform_admin").eq("id", user.id).maybeSingle(),
    supabase
      .from("workspace_members")
      .select(`role, workspaces(${WORKSPACE_COLUMNS})`)
      .eq("user_id", user.id)
      .order("created_at")
      .returns<MembershipRow[]>(),
  ]);

  const email = profile.data?.email ?? user.email ?? "";
  return {
    user: {
      id: user.id,
      email,
      name: profile.data?.full_name || email.split("@")[0],
      isPlatformAdmin: profile.data?.is_platform_admin === true,
    },
    workspaces: (memberships.data ?? []).flatMap((m) => (m.workspaces ? [rowToWorkspace(m.workspaces, m.role)] : [])),
  };
}
