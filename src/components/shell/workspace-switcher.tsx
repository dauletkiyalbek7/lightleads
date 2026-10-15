"use client";

import { Building2, Check, ChevronsUpDown, Plus } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { NewProjectDialog } from "@/components/features/new-project-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { t } from "@/i18n";
import { useApp } from "@/lib/store";
import { cn } from "@/lib/utils";

const initials = (name: string) =>
  name
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

export function WorkspaceAvatar({ name, className }: { name: string; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex size-9 shrink-0 items-center justify-center rounded-[12px] bg-gradient-to-br from-coral to-sun text-xs font-bold text-white",
        className,
      )}
    >
      {initials(name)}
    </span>
  );
}

/** Переключатель проектов. Новый проект создаёт себе любой вошедший человек. */
export function WorkspaceSwitcher({ labelClassName, className }: { labelClassName?: string; className?: string }) {
  const { workspaces, workspace, setWorkspaceId, user, demoMode } = useApp();
  const [creating, setCreating] = useState(false);
  return (
    <>
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          "flex min-h-11 w-full items-center gap-2.5 rounded-2xl p-1.5 text-left outline-none transition hover:bg-muted focus-visible:ring-4 focus-visible:ring-brand/25",
          className,
        )}
      >
        <WorkspaceAvatar name={workspace.name} />
        <span className={cn("min-w-0 flex-1", labelClassName)}>
          <span className="block truncate text-sm font-semibold">{workspace.name}</span>
          <span className="block truncate text-xs text-muted-foreground">{t.settings.team.roles[workspace.role]}</span>
        </span>
        <ChevronsUpDown className={cn("size-4 shrink-0 text-subtle", labelClassName)} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" sideOffset={8} className="w-64 rounded-2xl p-1.5">
        <DropdownMenuLabel className="px-2 text-xs font-medium text-muted-foreground">{t.nav.workspaces}</DropdownMenuLabel>
        {workspaces.map((ws) => (
          <DropdownMenuItem key={ws.id} onSelect={() => setWorkspaceId(ws.id)} className="min-h-11 gap-2.5 rounded-xl">
            <WorkspaceAvatar name={ws.name} className="size-8 rounded-[10px]" />
            <span className="flex-1 truncate font-medium">{ws.name}</span>
            {ws.id === workspace.id && <Check className="size-4 text-brand" />}
          </DropdownMenuItem>
        ))}
        {/* Гость в демо проектов не создаёт: для этого нужен аккаунт */}
        {!demoMode && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => setCreating(true)} className="min-h-11 gap-2.5 rounded-xl text-muted-foreground">
              <span className="inline-flex size-8 items-center justify-center rounded-[10px] bg-muted">
                <Plus className="size-4" />
              </span>
              {t.nav.newWorkspace}
            </DropdownMenuItem>
          </>
        )}
        {user?.isPlatformAdmin && (
          <DropdownMenuItem asChild className="min-h-11 gap-2.5 rounded-xl text-muted-foreground">
            <Link href="/admin">
              <span className="inline-flex size-8 items-center justify-center rounded-[10px] bg-muted">
                <Building2 className="size-4" />
              </span>
              {t.nav.admin}
            </Link>
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
    <NewProjectDialog open={creating} onOpenChange={setCreating} />
    </>
  );
}
