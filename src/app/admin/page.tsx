import { redirect } from "next/navigation";
import { AdminPanel } from "@/components/features/admin-panel";
import { getSessionContext } from "@/lib/supabase/session";

/** Раздел владельца платформы: клиенты (workspace) и их доступы. */
export default async function AdminPage() {
  const session = await getSessionContext();
  if (!session) redirect("/login");
  if (!session.user.isPlatformAdmin) redirect("/dashboard");
  return <AdminPanel user={session.user} />;
}
