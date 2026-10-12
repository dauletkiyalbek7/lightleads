import type { ReactNode } from "react";
import { AppShell } from "@/components/shell/app-shell";
import { AppProvider } from "@/lib/store";

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <AppProvider>
      <AppShell>{children}</AppShell>
    </AppProvider>
  );
}
