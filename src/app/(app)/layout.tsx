import type { ReactNode } from "react";
import { NoWorkspace } from "@/components/features/no-workspace";
import { AppShell } from "@/components/shell/app-shell";
import { AppProvider } from "@/lib/store";
import { getSessionContext } from "@/lib/supabase/session";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const session = await getSessionContext();
  if (session && session.workspaces.length === 0) return <NoWorkspace user={session.user} />;
  return (
    <AppProvider session={session}>
      <AppShell>{children}</AppShell>
    </AppProvider>
  );
}
