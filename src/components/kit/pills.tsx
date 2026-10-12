import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import type { ReactNode } from "react";
import { t } from "@/i18n";
import { formatPercent } from "@/lib/format";
import type { Priority } from "@/lib/rules";
import type { CreativeBadge } from "@/lib/score";
import type { EntityStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

const PILL = "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium whitespace-nowrap";

const TONES = {
  success: "bg-success/12 text-[#067647]",
  danger: "bg-danger/10 text-[#B42318]",
  warning: "bg-warning/14 text-[#B54708]",
  brand: "bg-brand-soft text-accent-foreground",
  coral: "bg-coral/12 text-[#C2264A]",
  muted: "bg-muted text-muted-foreground",
} as const;

export function Pill({ tone = "muted", className, children }: { tone?: keyof typeof TONES; className?: string; children: ReactNode }) {
  return <span className={cn(PILL, TONES[tone], className)}>{children}</span>;
}

interface DeltaProps {
  value: number | null;
  /** Что считать хорошим: рост (выручка), падение (CPL) или ничего (расход). */
  good?: "up" | "down" | "none";
  className?: string;
}

const DELTA_EPSILON = 0.0005;

/** Дельта к прошлому периоду. Цвет = направление × «хорошо ли это». */
export function Delta({ value, good = "up", className }: DeltaProps) {
  if (value === null) return null;
  const flat = Math.abs(value) < DELTA_EPSILON;
  const up = value > 0;
  const positive = good === "none" || flat ? null : good === "up" ? up : !up;
  const Icon = flat ? Minus : up ? ArrowUpRight : ArrowDownRight;
  return (
    <span
      className={cn(
        PILL,
        "num gap-0.5 px-2 py-0.5",
        positive === null ? TONES.muted : positive ? TONES.success : TONES.danger,
        className,
      )}
    >
      <Icon className="size-3.5" />
      {formatPercent(Math.abs(value), 1)}
    </span>
  );
}

const ROMI_RED_HUE = 4;
const ROMI_YELLOW_HUE = 44;
const ROMI_GREEN_HUE = 152;
const ROMI_FULL_GREEN = 1.5;

/** Цвет ROMI: красный (убыток) → жёлтый (около нуля) → зелёный (прибыль). */
export function romiColors(romi: number): { background: string; color: string } {
  const hue =
    romi < 0
      ? ROMI_RED_HUE + (ROMI_YELLOW_HUE - ROMI_RED_HUE) * Math.max(0, 1 + romi)
      : ROMI_YELLOW_HUE + (ROMI_GREEN_HUE - ROMI_YELLOW_HUE) * Math.min(1, romi / ROMI_FULL_GREEN);
  return { background: `hsl(${hue} 92% 93%)`, color: `hsl(${hue} 78% 26%)` };
}

export function RomiPill({ value, className }: { value: number | null; className?: string }) {
  if (value === null) return <span className="text-subtle">—</span>;
  return (
    <span className={cn(PILL, "num font-semibold", className)} style={romiColors(value)}>
      {formatPercent(value, 0)}
    </span>
  );
}

export function StatusDot({ status, label }: { status: EntityStatus; label?: boolean }) {
  const active = status === "active";
  return (
    <span className="inline-flex items-center gap-1.5 text-xs whitespace-nowrap text-muted-foreground">
      <span className={cn("size-2 rounded-full", active ? "bg-success shadow-[0_0_0_3px_rgba(18,183,106,0.18)]" : "bg-subtle/60")} />
      {label && (active ? t.status.active : t.status.paused)}
    </span>
  );
}

const BADGE_TONES: Record<CreativeBadge, keyof typeof TONES> = {
  leader: "coral",
  growing: "success",
  fatigue: "warning",
  burner: "danger",
  lowdata: "muted",
  stable: "muted",
};

export function BadgePill({ badge, className }: { badge: CreativeBadge; className?: string }) {
  if (badge === "stable") return null;
  return (
    <Pill tone={BADGE_TONES[badge]} className={className}>
      {t.creatives.badge[badge]}
    </Pill>
  );
}

const PRIORITY_TONES: Record<Priority, keyof typeof TONES> = { high: "danger", medium: "warning", low: "brand" };

export function PriorityPill({ priority }: { priority: Priority }) {
  return (
    <Pill tone={PRIORITY_TONES[priority]}>
      <span className="size-1.5 rounded-full bg-current" />
      {t.ai.priority[priority]}
    </Pill>
  );
}
