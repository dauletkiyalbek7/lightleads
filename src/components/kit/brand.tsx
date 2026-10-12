import { Infinity as InfinityIcon, Music2, Zap } from "lucide-react";
import { APP } from "@/lib/config";
import type { Platform } from "@/lib/types";
import { cn } from "@/lib/utils";

export function LogoMark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "bg-brand-gradient inline-flex size-9 shrink-0 items-center justify-center rounded-[12px] text-on-brand shadow-brand",
        className,
      )}
    >
      <Zap className="size-[18px] fill-white" strokeWidth={0} />
    </span>
  );
}

export function Logo({ className, compact }: { className?: string; compact?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <LogoMark />
      {!compact && <span className="font-display text-[15px] font-semibold tracking-tight">{APP.name}</span>}
    </span>
  );
}

const SIZES = { sm: "size-5 rounded-md [&_svg]:size-3", md: "size-7 rounded-lg [&_svg]:size-4", lg: "size-10 rounded-xl [&_svg]:size-5" } as const;

/** Meta — синий #0866FF; TikTok — чёрный с бирюзово-розовым акцентом. */
export function PlatformIcon({ platform, size = "md", className }: { platform: Platform; size?: keyof typeof SIZES; className?: string }) {
  if (platform === "meta") {
    return (
      <span className={cn("inline-flex shrink-0 items-center justify-center bg-meta text-white", SIZES[size], className)} aria-label="Meta">
        <InfinityIcon strokeWidth={2.6} />
      </span>
    );
  }
  return (
    <span className={cn("inline-flex shrink-0 items-center justify-center bg-tiktok text-white", SIZES[size], className)} aria-label="TikTok">
      <Music2 strokeWidth={2.6} className="[filter:drop-shadow(-1px_-1px_0_#25F4EE)_drop-shadow(1px_1px_0_#FE2C55)]" />
    </span>
  );
}
