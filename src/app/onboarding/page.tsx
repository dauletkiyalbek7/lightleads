"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Check, ClipboardList, Coins, FileSpreadsheet, Globe, Hand, LoaderCircle, MessageCircle, Send, Users, Workflow, X, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent, type ReactNode } from "react";
import { toast } from "sonner";
import { Logo, PlatformIcon } from "@/components/kit/brand";
import { Btn } from "@/components/kit/btn";
import { Field, Input } from "@/components/kit/field";
import { EASE_OUT } from "@/components/kit/motion";
import { Segmented } from "@/components/kit/segmented";
import { Surface } from "@/components/kit/surface";
import { Checkbox } from "@/components/ui/checkbox";
import { t } from "@/i18n";
import { celebrate } from "@/lib/confetti";
import { CURRENCY_SYMBOL } from "@/lib/format";
import type { Currency, Platform } from "@/lib/types";
import { cn } from "@/lib/utils";

const STEPS = ["meta", "tiktok", "leads", "sales", "money", "team"] as const;
type StepKey = (typeof STEPS)[number];
const CONNECT_DEMO_MS = 1300;
const DEFAULT_MARGIN = "55";

const DEMO_ACCOUNTS: Record<Platform, { id: string; name: string; meta: string }[]> = {
  meta: [
    { id: "act_1048220915573", name: "Aroma House — Meta", meta: "USD · Asia/Almaty" },
    { id: "act_2207718834410", name: "Aroma House — тест", meta: "USD · Asia/Almaty" },
    { id: "act_9930041127765", name: "Личный аккаунт", meta: "KZT · Asia/Almaty" },
  ],
  tiktok: [
    { id: "7312904455180", name: "Aroma House KZ — TikTok", meta: "KZT · Asia/Almaty" },
    { id: "7298811020347", name: "Aroma House — Spark", meta: "USD · Asia/Almaty" },
  ],
};

function ConnectStep({ platform, connected, onConnected }: { platform: Platform; connected: boolean; onConnected: () => void }) {
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set([DEMO_ACCOUNTS[platform][0].id]));
  const copy = t.onboarding.steps[platform];

  const connect = () => {
    setLoading(true);
    window.setTimeout(() => {
      setLoading(false);
      onConnected();
      celebrate();
      toast.success(t.onboarding.connectedToast);
    }, CONNECT_DEMO_MS);
  };

  if (!connected) {
    return (
      <div className="flex flex-col items-center rounded-[20px] bg-muted/50 px-6 py-10 text-center">
        <PlatformIcon platform={platform} size="lg" className="size-16 rounded-[20px] [&_svg]:size-8" />
        <Btn className="mt-6" size="lg" onClick={connect} disabled={loading}>
          {loading && <LoaderCircle className="animate-spin" />}
          {copy.action}
        </Btn>
        <p className="mt-4 max-w-xs text-xs text-subtle">{t.settings.connections.demoConnect}</p>
      </div>
    );
  }

  return (
    <div>
      <p className="mb-3 text-sm font-semibold">{copy.accountsTitle}</p>
      <ul className="space-y-2">
        {DEMO_ACCOUNTS[platform].map((account) => {
          const checked = selected.has(account.id);
          return (
            <li key={account.id}>
              <label
                className={cn(
                  "flex min-h-16 cursor-pointer items-center gap-3 rounded-2xl border px-4 py-3 transition",
                  checked ? "border-brand bg-brand-soft/60" : "border-border hover:border-brand/40",
                )}
              >
                <Checkbox
                  checked={checked}
                  onCheckedChange={(on) =>
                    setSelected((prev) => {
                      const next = new Set(prev);
                      if (on) next.add(account.id);
                      else next.delete(account.id);
                      return next;
                    })
                  }
                  className="size-5"
                />
                <PlatformIcon platform={platform} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">{account.name}</span>
                  <span className="num block truncate text-xs text-muted-foreground">
                    {account.id} · {account.meta}
                  </span>
                </span>
              </label>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

interface Choice {
  key: string;
  name: string;
  text: string;
  icon: LucideIcon;
}

function ChoiceGrid({ choices, value, onChange }: { choices: Choice[]; value: Set<string>; onChange: (next: Set<string>) => void }) {
  return (
    <ul className="grid gap-2.5 sm:grid-cols-2">
      {choices.map((choice) => {
        const active = value.has(choice.key);
        return (
          <li key={choice.key}>
            <motion.button
              type="button"
              whileTap={{ scale: 0.98 }}
              aria-pressed={active}
              onClick={() => {
                const next = new Set(value);
                if (active) next.delete(choice.key);
                else next.add(choice.key);
                onChange(next);
              }}
              className={cn(
                "flex min-h-20 w-full items-center gap-3 rounded-2xl border p-4 text-left outline-none transition focus-visible:ring-4 focus-visible:ring-brand/25",
                active ? "border-brand bg-brand-soft/60" : "border-border hover:border-brand/40",
              )}
            >
              <span className={cn("inline-flex size-11 shrink-0 items-center justify-center rounded-[14px]", active ? "bg-brand-fill text-on-brand" : "bg-muted text-muted-foreground")}>
                <choice.icon className="size-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold">{choice.name}</span>
                <span className="block text-xs text-muted-foreground">{choice.text}</span>
              </span>
              <span className={cn("inline-flex size-6 shrink-0 items-center justify-center rounded-full border", active ? "border-brand-fill-2 bg-brand-fill text-on-brand" : "border-border")}>
                {active && <Check className="size-3.5" strokeWidth={3} />}
              </span>
            </motion.button>
          </li>
        );
      })}
    </ul>
  );
}

const withIcons = <K extends string>(options: Record<K, { name: string; text: string }>, icons: Record<K, LucideIcon>): Choice[] =>
  (Object.keys(options) as K[]).map((key) => ({ key, ...options[key], icon: icons[key] }));

export default function OnboardingPage() {
  const router = useRouter();
  const [index, setIndex] = useState(0);
  const [direction, setDirection] = useState(1);
  const [connected, setConnected] = useState<Record<Platform, boolean>>({ meta: false, tiktok: false });
  const [leadSources, setLeadSources] = useState<Set<string>>(new Set(["forms"]));
  const [salesInputs, setSalesInputs] = useState<Set<string>>(new Set(["manual"]));
  const [currency, setCurrency] = useState<Currency>("KZT");
  const [margin, setMargin] = useState(DEFAULT_MARGIN);
  const [emails, setEmails] = useState<string[]>([]);
  const [email, setEmail] = useState("");

  const step: StepKey = STEPS[index];
  const copy = t.onboarding.steps[step];
  const isLast = index === STEPS.length - 1;

  const go = (delta: number) => {
    setDirection(delta);
    setIndex((i) => Math.min(STEPS.length - 1, Math.max(0, i + delta)));
  };
  const finish = () => {
    celebrate({ x: 0.5, y: 0.5 });
    toast.success(t.onboarding.finished);
    router.push("/dashboard");
  };
  const addEmail = (e: FormEvent) => {
    e.preventDefault();
    const value = email.trim();
    if (!value.includes("@") || emails.includes(value)) return;
    setEmails((list) => [...list, value]);
    setEmail("");
  };

  const leadChoices = withIcons(t.onboarding.steps.leads.options, { forms: ClipboardList, site: Globe, whatsapp: MessageCircle, instagram: Send });
  const salesChoices = withIcons(t.onboarding.steps.sales.options, { manual: Hand, csv: FileSpreadsheet, sheets: FileSpreadsheet, crm: Workflow });
  const stepIcons: Record<StepKey, ReactNode> = {
    meta: <PlatformIcon platform="meta" size="sm" />,
    tiktok: <PlatformIcon platform="tiktok" size="sm" />,
    leads: <ClipboardList className="size-4" />,
    sales: <Hand className="size-4" />,
    money: <Coins className="size-4" />,
    team: <Users className="size-4" />,
  };

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <header className="mx-auto flex h-16 w-full max-w-5xl items-center justify-between px-4 md:px-6">
        <Link href="/" aria-label={t.common.appName}>
          <Logo />
        </Link>
        <Link href="/dashboard" className="inline-flex min-h-11 items-center px-2 text-sm font-medium text-muted-foreground hover:text-brand">
          {t.common.skip}
        </Link>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 pt-2 pb-32 md:px-6 md:pt-8 md:pb-12">
        <div className="mb-6 md:mb-8">
          <p className="num text-sm font-medium text-brand">{t.onboarding.stepOf({ current: index + 1, total: STEPS.length })}</p>
          <h1 className="font-display mt-1 text-2xl font-semibold tracking-tight md:text-3xl">{t.onboarding.title}</h1>
          <div className="mt-4 h-2 overflow-hidden rounded-full bg-muted">
            <motion.div
              className="bg-brand-gradient h-full rounded-full"
              initial={false}
              animate={{ width: `${((index + 1) / STEPS.length) * 100}%` }}
              transition={{ duration: 0.5, ease: EASE_OUT }}
            />
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
          <ol className="hidden space-y-1 lg:block">
            {STEPS.map((key, i) => {
              const done = i < index;
              const active = i === index;
              return (
                <li key={key}>
                  <button
                    type="button"
                    onClick={() => go(i - index)}
                    className={cn(
                      "flex min-h-12 w-full items-center gap-3 rounded-2xl px-3 text-left text-sm font-medium outline-none transition focus-visible:ring-4 focus-visible:ring-brand/25",
                      active ? "bg-card shadow-card" : "text-muted-foreground hover:bg-card/70",
                    )}
                  >
                    <span
                      className={cn(
                        "inline-flex size-8 shrink-0 items-center justify-center rounded-full",
                        done ? "bg-success text-white" : active ? "bg-brand-soft text-brand" : "bg-muted",
                      )}
                    >
                      {done ? <Check className="size-4" strokeWidth={3} /> : stepIcons[key]}
                    </span>
                    <span className="truncate">{t.onboarding.steps[key].title}</span>
                  </button>
                </li>
              );
            })}
          </ol>

          <Surface className="overflow-hidden p-5 md:p-8">
            <AnimatePresence mode="wait" custom={direction} initial={false}>
              <motion.div
                key={step}
                custom={direction}
                initial={{ opacity: 0, x: 28 * direction }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -28 * direction }}
                transition={{ duration: 0.28, ease: EASE_OUT }}
              >
                <h2 className="font-display text-xl font-semibold tracking-tight">{copy.title}</h2>
                <p className="mt-2 mb-6 max-w-xl text-sm leading-relaxed text-muted-foreground">{copy.text}</p>

                {(step === "meta" || step === "tiktok") && (
                  <ConnectStep platform={step} connected={connected[step]} onConnected={() => setConnected((c) => ({ ...c, [step]: true }))} />
                )}
                {step === "leads" && <ChoiceGrid choices={leadChoices} value={leadSources} onChange={setLeadSources} />}
                {step === "sales" && <ChoiceGrid choices={salesChoices} value={salesInputs} onChange={setSalesInputs} />}
                {step === "money" && (
                  <div className="max-w-sm space-y-5">
                    <Field label={t.onboarding.steps.money.salesCurrency}>
                      <Segmented
                        value={currency}
                        onChange={setCurrency}
                        full
                        options={[
                          { value: "KZT", label: `${CURRENCY_SYMBOL.KZT} KZT` },
                          { value: "USD", label: `${CURRENCY_SYMBOL.USD} USD` },
                        ]}
                      />
                    </Field>
                    <Field label={t.onboarding.steps.money.margin} hint={t.onboarding.steps.money.marginHint}>
                      <Input inputMode="numeric" value={margin} onChange={(e) => setMargin(e.target.value.replace(/\D/g, "").slice(0, 2))} className="num w-28 text-lg font-semibold" />
                    </Field>
                  </div>
                )}
                {step === "team" && (
                  <div className="max-w-md">
                    <form onSubmit={addEmail} className="flex gap-2">
                      <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t.onboarding.steps.team.placeholder} />
                      <Btn type="submit" variant="soft">
                        {t.onboarding.steps.team.add}
                      </Btn>
                    </form>
                    <ul className="mt-3 flex flex-wrap gap-2">
                      {emails.map((item) => (
                        <li key={item} className="inline-flex min-h-9 items-center gap-1 rounded-full bg-brand-soft pr-1 pl-3.5 text-sm font-medium text-accent-foreground">
                          {item}
                          <button
                            type="button"
                            onClick={() => setEmails((list) => list.filter((x) => x !== item))}
                            aria-label={t.common.remove}
                            className="inline-flex size-7 items-center justify-center rounded-full hover:bg-white/70"
                          >
                            <X className="size-3.5" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </motion.div>
            </AnimatePresence>

            {/* Кнопки: на телефоне закреплены внизу */}
            <div className="fixed inset-x-0 bottom-0 z-20 flex items-center gap-2 border-t border-border bg-card/95 px-4 pt-3 pb-[max(env(safe-area-inset-bottom),0.75rem)] backdrop-blur-xl md:static md:mt-8 md:border-0 md:bg-transparent md:p-0 md:backdrop-blur-none">
              {index > 0 && (
                <Btn variant="secondary" onClick={() => go(-1)}>
                  {t.common.back}
                </Btn>
              )}
              <span className="flex-1" />
              {!isLast && (
                <Btn variant="ghost" onClick={() => go(1)}>
                  {t.common.skip}
                </Btn>
              )}
              <Btn onClick={isLast ? finish : () => go(1)}>{isLast ? t.onboarding.finish : t.common.next}</Btn>
            </div>
          </Surface>
        </div>
      </main>
    </div>
  );
}
