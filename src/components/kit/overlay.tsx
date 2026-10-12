"use client";

import type { ReactNode } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle, DrawerTrigger } from "@/components/ui/drawer";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useIsMobile } from "@/hooks/use-media-query";
import { cn } from "@/lib/utils";

interface ModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  /** Закреплённый низ (кнопки). */
  footer?: ReactNode;
  size?: "md" | "lg";
}

/** Диалог на десктопе, bottom sheet на телефоне. */
export function Modal({ open, onOpenChange, title, description, children, footer, size = "md" }: ModalProps) {
  const isMobile = useIsMobile();

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange} repositionInputs={false}>
        <DrawerContent className="max-h-[94dvh] rounded-t-[28px] border-0 bg-card">
          <DrawerHeader className="px-5 pt-4 pb-2 text-left">
            <DrawerTitle className="font-display text-lg font-semibold tracking-tight">{title}</DrawerTitle>
            <DrawerDescription className={cn("text-sm text-muted-foreground", !description && "sr-only")}>
              {description ?? title}
            </DrawerDescription>
          </DrawerHeader>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">{children}</div>
          {footer && <div className="border-t border-border bg-card px-5 pt-3 pb-[max(env(safe-area-inset-bottom),0.75rem)]">{footer}</div>}
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          const content = e.currentTarget as HTMLElement;
          if (!content.contains(document.activeElement)) content.focus();
        }}
        className={cn(
          "flex max-h-[88dvh] flex-col gap-0 overflow-hidden rounded-[28px] border-0 bg-card p-0 shadow-lift ring-0",
          size === "lg" ? "sm:max-w-3xl" : "sm:max-w-lg",
        )}
      >
        <DialogHeader className="px-6 pt-6 pb-3 text-left">
          <DialogTitle className="font-display text-lg font-semibold tracking-tight">{title}</DialogTitle>
          <DialogDescription className={cn("text-sm text-muted-foreground", !description && "sr-only")}>
            {description ?? title}
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">{children}</div>
        {footer && <div className="border-t border-border px-6 py-4">{footer}</div>}
      </DialogContent>
    </Dialog>
  );
}

interface PopProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger: ReactNode;
  title: string;
  children: ReactNode;
  align?: "start" | "center" | "end";
  className?: string;
}

/** Поповер на десктопе, bottom sheet на телефоне (фильтры, период). */
export function Pop({ open, onOpenChange, trigger, title, children, align = "end", className }: PopProps) {
  const isMobile = useIsMobile();

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerTrigger asChild>{trigger}</DrawerTrigger>
        <DrawerContent className="max-h-[90dvh] rounded-t-[28px] border-0 bg-card">
          <DrawerHeader className="px-5 pt-4 pb-2 text-left">
            <DrawerTitle className="font-display text-lg font-semibold tracking-tight">{title}</DrawerTitle>
            <DrawerDescription className="sr-only">{title}</DrawerDescription>
          </DrawerHeader>
          <div className="overflow-y-auto px-5 pb-[max(env(safe-area-inset-bottom),1.25rem)]">{children}</div>
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent align={align} sideOffset={8} className={cn("w-auto rounded-[20px] border-0 p-4 shadow-lift ring-1 ring-border", className)}>
        {children}
      </PopoverContent>
    </Popover>
  );
}
