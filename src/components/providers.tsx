"use client";

import { MotionConfig } from "framer-motion";
import type { ReactNode } from "react";
import { Toaster } from "sonner";
import { TooltipProvider } from "@/components/ui/tooltip";

/** reducedMotion="user" — Framer Motion сам уважает prefers-reduced-motion. */
export function Providers({ children }: { children: ReactNode }) {
  return (
    <MotionConfig reducedMotion="user">
      <TooltipProvider delayDuration={150}>
        {children}
        <Toaster
          theme="light"
          position="top-center"
          toastOptions={{
            classNames: {
              toast: "!rounded-2xl !border-border !shadow-lift !font-sans",
              title: "!font-semibold",
            },
          }}
        />
      </TooltipProvider>
    </MotionConfig>
  );
}
