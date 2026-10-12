"use client";

import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { EASE_OUT } from "./motion";

const GOOD_SCORE = 70;
const OK_SCORE = 45;

export function scoreColor(score: number): string {
  if (score >= GOOD_SCORE) return "var(--success)";
  if (score >= OK_SCORE) return "var(--warning)";
  return "var(--danger)";
}

const SIZES = { sm: { box: 40, stroke: 4, text: "text-xs" }, md: { box: 52, stroke: 5, text: "text-sm" }, lg: { box: 88, stroke: 8, text: "text-2xl" } } as const;

/** Рейтинг креатива 0–100 в виде кольца. */
export function ScoreRing({ score, size = "md", className }: { score: number; size?: keyof typeof SIZES; className?: string }) {
  const { box, stroke, text } = SIZES[size];
  const radius = (box - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  return (
    <span className={cn("relative inline-flex shrink-0 items-center justify-center", className)} style={{ width: box, height: box }}>
      <svg width={box} height={box} className="-rotate-90">
        <circle cx={box / 2} cy={box / 2} r={radius} fill="none" stroke="var(--muted)" strokeWidth={stroke} />
        <motion.circle
          cx={box / 2}
          cy={box / 2}
          r={radius}
          fill="none"
          stroke={scoreColor(score)}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: circumference * (1 - score / 100) }}
          transition={{ duration: 0.9, ease: EASE_OUT }}
        />
      </svg>
      <span className={cn("num font-display absolute font-semibold", text)}>{score}</span>
    </span>
  );
}
