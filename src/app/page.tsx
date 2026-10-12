"use client";

import { motion } from "framer-motion";
import { ArrowRight, Check, Coins, Images, PiggyBank, ShoppingBag, Sparkles, Timer, UserRound, Wallet, Waypoints } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { LandingDemo } from "@/components/features/landing-demo";
import { Logo, PlatformIcon } from "@/components/kit/brand";
import { Btn } from "@/components/kit/btn";
import { EASE_OUT, Stagger, StaggerItem } from "@/components/kit/motion";
import { IconPill, Surface, type Tone } from "@/components/kit/surface";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";

const CHAIN_ICONS = [<Wallet key="w" />, <UserRound key="u" />, <ShoppingBag key="s" />, <PiggyBank key="p" />];
const CHAIN_TONES: Tone[] = ["coral", "blue", "sun", "success"];
const FEATURE_ICONS = [<PiggyBank key="1" />, <Images key="2" />, <Timer key="3" />, <Coins key="4" />, <Sparkles key="5" />, <Waypoints key="6" />];
const FEATURE_TONES: Tone[] = ["success", "coral", "sun", "blue", "brand", "brand"];

function Reveal({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.55, ease: EASE_OUT }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

function Heading({ children, text }: { children: ReactNode; text?: string }) {
  return (
    <div className="mx-auto max-w-2xl text-center">
      <h2 className="font-display text-2xl leading-tight font-semibold tracking-tight md:text-[34px]">{children}</h2>
      {text && <p className="mt-3 text-muted-foreground">{text}</p>}
    </div>
  );
}

export default function LandingPage() {
  const l = t.landing;
  return (
    <div className="relative overflow-hidden bg-background">
      {/* Яркие размытые пятна фона */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-[900px]">
        <span className="absolute -top-40 left-[8%] size-[520px] rounded-full bg-brand-fill/25 blur-[120px]" />
        <span className="absolute top-10 right-[4%] size-[440px] rounded-full bg-brand-fill-2/25 blur-[120px]" />
        <span className="absolute top-[420px] left-[42%] size-[320px] rounded-full bg-coral/15 blur-[110px]" />
      </div>

      <header className="relative mx-auto flex h-18 max-w-6xl items-center justify-between gap-4 px-4 md:px-6">
        <Link href="/" aria-label={t.common.appName}>
          <Logo />
        </Link>
        <nav className="hidden items-center gap-1 md:flex">
          {(
            [
              ["#features", l.nav.features],
              ["#how", l.nav.how],
              ["#pricing", l.nav.pricing],
            ] as const
          ).map(([href, label]) => (
            <a key={href} href={href} className="inline-flex min-h-10 items-center rounded-xl px-3.5 text-sm font-medium text-muted-foreground hover:bg-card hover:text-foreground">
              {label}
            </a>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <Btn href="/login" variant="ghost" size="sm" className="h-10">
            {l.nav.login}
          </Btn>
          <Btn href="/dashboard" size="sm" className="h-10 rounded-2xl px-4">
            {l.nav.try}
          </Btn>
        </div>
      </header>

      <main className="relative">
        {/* Hero */}
        <section className="mx-auto max-w-6xl px-4 pt-10 pb-10 text-center md:px-6 md:pt-20 md:pb-14">
          <Stagger className="flex flex-col items-center">
            <StaggerItem>
              <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3.5 py-1.5 text-[13px] font-medium shadow-card">
                <PlatformIcon platform="meta" size="sm" />
                <PlatformIcon platform="tiktok" size="sm" />
                {l.badge}
              </span>
            </StaggerItem>
            <StaggerItem>
              <h1 className="font-display mt-6 max-w-4xl text-[34px] leading-[1.12] font-semibold tracking-tight sm:text-5xl md:text-[64px]">
                {l.heroTitleA} <span className="text-brand-gradient">{l.heroTitleB}</span>
              </h1>
            </StaggerItem>
            <StaggerItem>
              <p className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-muted-foreground md:text-lg">{l.heroText}</p>
            </StaggerItem>
            <StaggerItem className="mt-8 flex w-full flex-col items-center justify-center gap-3 sm:w-auto sm:flex-row">
              <Btn href="/register" size="lg" className="w-full sm:w-auto">
                {l.heroCta}
                <ArrowRight />
              </Btn>
              <Btn href="/dashboard" variant="secondary" size="lg" className="w-full sm:w-auto">
                {l.heroSecondary}
              </Btn>
            </StaggerItem>
            <StaggerItem>
              <p className="mt-4 text-[13px] text-subtle">{l.heroNote}</p>
            </StaggerItem>
          </Stagger>
        </section>

        {/* Демо дашборда */}
        <section className="mx-auto max-w-6xl px-4 md:px-6" aria-label={l.demoTitle}>
          <Reveal>
            <div className="rounded-[28px] border border-border bg-card/70 p-2 shadow-lift backdrop-blur md:p-3">
              <div className="flex items-center gap-2 px-3 py-2.5">
                <span className="size-2.5 rounded-full bg-coral" />
                <span className="size-2.5 rounded-full bg-sun" />
                <span className="size-2.5 rounded-full bg-success" />
                <span className="ml-3 truncate text-xs text-subtle">{l.demoTitle}</span>
              </div>
              <div className="rounded-[22px] bg-background p-3 md:p-5">
                <LandingDemo />
              </div>
            </div>
          </Reveal>
        </section>

        {/* Цепочка данных */}
        <section id="how" className="mx-auto max-w-6xl scroll-mt-10 px-4 py-16 md:px-6 md:py-24">
          <Reveal>
            <Heading>{l.chainTitle}</Heading>
          </Reveal>
          <div className="mt-10 grid gap-3 md:grid-cols-4 md:gap-4">
            {l.chain.map((step, i) => (
              <Reveal key={step.title} className="relative">
                <Surface className="h-full p-5 md:p-6">
                  <IconPill tone={CHAIN_TONES[i]}>{CHAIN_ICONS[i]}</IconPill>
                  <h3 className="font-display mt-4 text-base font-semibold">{step.title}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{step.text}</p>
                </Surface>
                {i < l.chain.length - 1 && (
                  <span className="absolute top-1/2 -right-3.5 z-10 hidden size-7 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-card text-brand shadow-card md:inline-flex">
                    <ArrowRight className="size-3.5" />
                  </span>
                )}
              </Reveal>
            ))}
          </div>
        </section>

        {/* Возможности */}
        <section id="features" className="mx-auto max-w-6xl scroll-mt-10 px-4 pb-16 md:px-6 md:pb-24">
          <Reveal>
            <Heading>{l.featuresTitle}</Heading>
          </Reveal>
          <div className="mt-10 grid gap-3 sm:grid-cols-2 md:gap-4 lg:grid-cols-3">
            {l.features.map((feature, i) => (
              <Reveal key={feature.title}>
                <Surface className="h-full p-5 transition duration-300 hover:-translate-y-1 hover:shadow-lift md:p-6">
                  <IconPill tone={FEATURE_TONES[i]}>{FEATURE_ICONS[i]}</IconPill>
                  <h3 className="font-display mt-4 text-base font-semibold">{feature.title}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{feature.text}</p>
                </Surface>
              </Reveal>
            ))}
          </div>
        </section>

        {/* Тарифы-заглушка */}
        <section id="pricing" className="mx-auto max-w-6xl scroll-mt-10 px-4 pb-16 md:px-6 md:pb-24">
          <Reveal>
            <Heading text={l.pricingText}>{l.pricingTitle}</Heading>
          </Reveal>
          <div className="mt-10 grid gap-3 md:grid-cols-3 md:gap-4">
            {l.plans.map((plan) => (
              <Reveal key={plan.name}>
                <Surface className={cn("flex h-full flex-col p-6", plan.featured && "bg-brand-gradient border-0 text-on-brand shadow-brand-lg")}>
                  <h3 className="font-display text-base font-semibold">{plan.name}</h3>
                  <p className="font-display mt-4 text-3xl font-semibold tracking-tight">{plan.price}</p>
                  <p className={cn("mt-1 text-sm", plan.featured ? "text-on-brand/75" : "text-muted-foreground")}>{plan.period}</p>
                  <ul className="mt-6 flex-1 space-y-2.5 text-sm">
                    {plan.features.map((feature) => (
                      <li key={feature} className="flex items-center gap-2.5">
                        <span className={cn("inline-flex size-5 shrink-0 items-center justify-center rounded-full", plan.featured ? "bg-white/20" : "bg-success/12 text-success")}>
                          <Check className="size-3" strokeWidth={3} />
                        </span>
                        {feature}
                      </li>
                    ))}
                  </ul>
                  <Btn href="/register" variant={plan.featured ? "secondary" : "soft"} className={cn("mt-6 w-full", plan.featured && "border-0")}>
                    {plan.cta}
                  </Btn>
                </Surface>
              </Reveal>
            ))}
          </div>
        </section>

        {/* Финальный призыв */}
        <section className="mx-auto max-w-6xl px-4 pb-16 md:px-6 md:pb-24">
          <Reveal>
            <div className="bg-brand-gradient relative overflow-hidden rounded-[32px] px-6 py-12 text-center text-on-brand shadow-brand-lg md:px-12 md:py-16">
              <span className="absolute -top-20 -left-10 size-64 rounded-full bg-white/15 blur-2xl" />
              <span className="absolute -right-10 -bottom-24 size-72 rounded-full bg-brand-glow/40 blur-3xl" />
              <div className="relative">
                <h2 className="font-display mx-auto max-w-2xl text-2xl leading-tight font-semibold tracking-tight md:text-4xl">{l.ctaTitle}</h2>
                <p className="mx-auto mt-3 max-w-xl text-on-brand/85">{l.ctaText}</p>
                <Btn href="/dashboard" variant="secondary" size="lg" className="mt-8 border-0">
                  {l.heroCta}
                  <ArrowRight />
                </Btn>
              </div>
            </div>
          </Reveal>
        </section>
      </main>

      <footer className="relative mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 border-t border-border px-4 py-8 text-sm text-muted-foreground sm:flex-row md:px-6">
        <Logo />
        <p>
          © {new Date().getFullYear()} {t.common.appName} · {l.footer}
        </p>
      </footer>
    </div>
  );
}
