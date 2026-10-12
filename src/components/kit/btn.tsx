"use client";

import { motion, type HTMLMotionProps } from "framer-motion";
import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

const MotionLink = motion.create(Link);

const BASE =
  "relative inline-flex shrink-0 items-center justify-center gap-2 font-semibold whitespace-nowrap select-none outline-none transition-[box-shadow,background-color,color] duration-200 focus-visible:ring-4 focus-visible:ring-brand/25 disabled:pointer-events-none disabled:opacity-50 [&_svg]:shrink-0";

const VARIANTS = {
  /** Основная кнопка: переливающийся градиент, цветная тень */
  primary: "btn-shimmer text-on-brand shadow-brand hover:shadow-brand-lg",
  secondary: "border border-border bg-card text-foreground shadow-card hover:shadow-lift",
  soft: "bg-brand-soft text-accent-foreground hover:bg-brand-soft-hover",
  ghost: "text-muted-foreground hover:bg-muted hover:text-foreground",
  danger: "bg-danger/10 text-danger hover:bg-danger/15",
} as const;

/** md и крупнее — не меньше 44px, чтобы попадать пальцем. */
const SIZES = {
  sm: "h-9 rounded-xl px-3.5 text-sm [&_svg]:size-4",
  md: "h-11 rounded-2xl px-5 text-sm [&_svg]:size-[18px]",
  lg: "h-13 rounded-2xl px-7 text-base [&_svg]:size-5",
  icon: "size-11 rounded-2xl [&_svg]:size-5",
  "icon-sm": "size-9 rounded-xl [&_svg]:size-4",
} as const;

const HOVER = { y: -2 };
const TAP = { scale: 0.97 };
const SPRING = { type: "spring", stiffness: 420, damping: 26 } as const;

interface CommonProps {
  variant?: keyof typeof VARIANTS;
  size?: keyof typeof SIZES;
  className?: string;
  children?: ReactNode;
}

type BtnProps = CommonProps & Omit<HTMLMotionProps<"button">, "children" | "className"> & { href?: undefined };
type LinkBtnProps = CommonProps & { href: string; "aria-label"?: string; onClick?: () => void };

export function Btn(props: BtnProps | LinkBtnProps) {
  const { variant = "primary", size = "md", className, children, ...rest } = props;
  const classes = cn(BASE, VARIANTS[variant], SIZES[size], className);

  if (typeof rest.href === "string") {
    const { href, ...linkRest } = rest as LinkBtnProps;
    return (
      <MotionLink href={href} className={classes} whileHover={HOVER} whileTap={TAP} transition={SPRING} {...linkRest}>
        {children}
      </MotionLink>
    );
  }
  return (
    <motion.button
      type="button"
      className={classes}
      whileHover={HOVER}
      whileTap={TAP}
      transition={SPRING}
      {...(rest as Omit<BtnProps, keyof CommonProps>)}
    >
      {children}
    </motion.button>
  );
}
