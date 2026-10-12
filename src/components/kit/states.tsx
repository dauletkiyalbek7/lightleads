import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Surface } from "./surface";

export function Sk({ className }: { className?: string }) {
  return <div className={cn("skeleton-shine rounded-xl", className)} />;
}

/** Скелетон страницы вместо спиннера. */
export function PageSkeleton({ variant = "table" }: { variant?: "dashboard" | "table" | "grid" }) {
  return (
    <div className="space-y-4 md:space-y-6" aria-busy="true">
      {variant === "dashboard" && (
        <>
          <div className="grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-3">
            {Array.from({ length: 6 }, (_, i) => (
              <Surface key={i} className="space-y-4 p-5">
                <Sk className="size-10 rounded-[14px]" />
                <Sk className="h-7 w-3/4" />
                <Sk className="h-3 w-1/2" />
              </Surface>
            ))}
          </div>
          <div className="grid gap-4 lg:grid-cols-3">
            <Surface className="p-6 lg:col-span-2">
              <Sk className="h-72 w-full" />
            </Surface>
            <Surface className="space-y-3 p-6">
              {Array.from({ length: 4 }, (_, i) => (
                <Sk key={i} className="h-14 w-full" />
              ))}
            </Surface>
          </div>
        </>
      )}
      {variant === "table" && (
        <>
          <Sk className="h-11 w-full max-w-md" />
          <Surface className="space-y-3 p-5">
            {Array.from({ length: 9 }, (_, i) => (
              <Sk key={i} className="h-12 w-full" />
            ))}
          </Surface>
        </>
      )}
      {variant === "grid" && (
        <>
          <Sk className="h-11 w-full max-w-md" />
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-4 xl:grid-cols-4">
            {Array.from({ length: 8 }, (_, i) => (
              <Surface key={i} className="space-y-3 p-3">
                <Sk className="aspect-[4/5] w-full rounded-2xl" />
                <Sk className="h-4 w-2/3" />
                <Sk className="h-3 w-1/2" />
              </Surface>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/** Дружелюбная иллюстрация для пустых состояний. */
function EmptyArt() {
  return (
    <svg viewBox="0 0 220 150" className="h-36 w-auto" aria-hidden="true">
      <defs>
        <linearGradient id="ea-a" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#6D5BFF" />
          <stop offset="1" stopColor="#3D8BFF" />
        </linearGradient>
        <linearGradient id="ea-b" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#FF5C7A" />
          <stop offset="1" stopColor="#FFB020" />
        </linearGradient>
      </defs>
      <circle cx="42" cy="34" r="10" fill="#FFB020" opacity="0.9" />
      <circle cx="188" cy="112" r="14" fill="#FF5C7A" opacity="0.18" />
      <circle cx="184" cy="30" r="5" fill="#12B76A" />
      <rect x="46" y="28" width="128" height="96" rx="20" fill="#fff" stroke="#E8EAF2" strokeWidth="2" />
      <rect x="62" y="44" width="44" height="8" rx="4" fill="#E8EAF2" />
      <rect x="62" y="60" width="26" height="6" rx="3" fill="#F2F4F9" />
      <rect x="64" y="92" width="14" height="18" rx="5" fill="url(#ea-a)" opacity="0.35" />
      <rect x="86" y="80" width="14" height="30" rx="5" fill="url(#ea-a)" opacity="0.6" />
      <rect x="108" y="70" width="14" height="40" rx="5" fill="url(#ea-a)" />
      <rect x="130" y="86" width="14" height="24" rx="5" fill="url(#ea-b)" />
      <circle cx="160" cy="46" r="17" fill="url(#ea-a)" />
      <path d="M160 38v16M152 46h16" stroke="#fff" strokeWidth="3.4" strokeLinecap="round" />
    </svg>
  );
}

interface EmptyStateProps {
  title: string;
  text?: string;
  action?: ReactNode;
  /** compact — без иллюстрации, для пустых списков внутри карточки. */
  compact?: boolean;
  className?: string;
}

export function EmptyState({ title, text, action, compact, className }: EmptyStateProps) {
  return (
    <div className={cn("flex flex-col items-center justify-center px-6 text-center", compact ? "py-10" : "py-14 md:py-20", className)}>
      {!compact && <EmptyArt />}
      <h3 className={cn("font-display font-semibold tracking-tight", compact ? "text-[15px]" : "mt-5 text-lg")}>{title}</h3>
      {text && <p className="mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">{text}</p>}
      {action && <div className="mt-6 flex flex-wrap items-center justify-center gap-2">{action}</div>}
    </div>
  );
}
