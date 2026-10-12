"use client";

import { LogOut } from "lucide-react";
import { Logo } from "@/components/kit/brand";
import { Btn } from "@/components/kit/btn";
import { Surface } from "@/components/kit/surface";
import { t } from "@/i18n";
import { getBrowserSupabase } from "@/lib/supabase/client";
import type { SessionUser } from "@/lib/types";

/** Вошедший пользователь, которого ещё не добавили ни в один workspace. */
export function NoWorkspace({ user }: { user: SessionUser }) {
  const s = t.account;
  const signOut = async () => {
    await getBrowserSupabase().auth.signOut();
    window.location.assign("/login");
  };
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-8 bg-background px-5 py-10">
      <Logo />
      <Surface className="w-full max-w-md p-8 text-center">
        <h1 className="font-display text-xl font-semibold tracking-tight">{s.noWorkspaceTitle}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{user.isPlatformAdmin ? s.noWorkspaceAdminText : s.noWorkspaceText}</p>
        <p className="mt-1 text-xs text-subtle">{user.email}</p>
        <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
          {user.isPlatformAdmin && <Btn href="/admin">{t.nav.admin}</Btn>}
          <Btn variant="secondary" onClick={signOut}>
            <LogOut />
            {t.nav.logout}
          </Btn>
        </div>
      </Surface>
    </div>
  );
}
