"use client";

import { AnimatePresence } from "framer-motion";
import { Check, FileSpreadsheet, MessageCircle, Plus, RefreshCw, Sparkles, Trash2, TriangleAlert, Workflow } from "lucide-react";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useTheme } from "@/hooks/use-theme";
import { toast } from "sonner";
import { z } from "zod";
import { WorkspaceAvatar } from "@/components/shell/workspace-switcher";
import { PlatformIcon } from "@/components/kit/brand";
import { Btn } from "@/components/kit/btn";
import { CopyBlock, Field, Input } from "@/components/kit/field";
import { FadeIn } from "@/components/kit/motion";
import { Pill } from "@/components/kit/pills";
import { Segmented } from "@/components/kit/segmented";
import { EmptyState, PageSkeleton } from "@/components/kit/states";
import { IconPill, Section, Surface } from "@/components/kit/surface";
import { t } from "@/i18n";
import { APP, ATTRIBUTION_WINDOWS } from "@/lib/config";
import { celebrate } from "@/lib/confetti";
import { rateOn } from "@/lib/currency";
import { addDays, formatDate } from "@/lib/dates";
import { CURRENCY_SYMBOL, formatMoney, formatNumber } from "@/lib/format";
import { DEMO_WORKSPACE_KEY, ingestExample, INGEST_PATH, SITE_SNIPPET, UTM_TEMPLATES } from "@/lib/snippets";
import { useApp } from "@/lib/store";
import { THEME_SWATCH, THEMES } from "@/lib/theme";
import type { Product } from "@/lib/types";
import { cn } from "@/lib/utils";

type Tab = keyof typeof t.settings.tabs;
const TABS = Object.keys(t.settings.tabs) as Tab[];
const RATE_HISTORY_DAYS = 7;
const RATE_DIGITS = 2;
/** Пример суммы из ТЗ для предпросмотра двойного отображения. */
const SAMPLE_USD = 1240.5;

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex min-h-11 items-center rounded-2xl border px-4 text-sm font-medium outline-none transition focus-visible:ring-4 focus-visible:ring-brand/25",
        active ? "border-brand bg-brand-soft text-accent-foreground" : "border-border bg-card hover:border-brand/40",
      )}
    >
      {children}
    </button>
  );
}

function Connections() {
  const { ds, syncNow, syncing } = useApp();
  const demo = () => toast(t.settings.connections.demoConnect);
  const s = t.settings.connections;
  return (
    <div className="space-y-4 md:space-y-6">
      <Section title={s.adsTitle} hint={s.adsHint}>
        {ds.accounts.length ? (
          <ul className="grid gap-3 lg:grid-cols-2">
            {ds.accounts.map((a) => (
              <li key={a.id} className="rounded-[20px] border border-border p-4">
                <div className="flex items-start gap-3">
                  <PlatformIcon platform={a.platform} size="lg" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{a.name}</p>
                    <p className="num truncate text-xs text-muted-foreground">{a.externalId}</p>
                  </div>
                  <Pill tone={a.status === "active" ? "success" : "warning"}>{a.status === "active" ? s.active : s.expired}</Pill>
                </div>
                <dl className="mt-3 flex gap-6 text-sm">
                  <div>
                    <dt className="text-xs text-muted-foreground">{s.currencyLabel}</dt>
                    <dd className="font-medium">{a.currency}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">{s.timezone}</dt>
                    <dd className="font-medium">{a.timezone}</dd>
                  </div>
                </dl>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Btn variant="soft" size="sm" onClick={syncNow} disabled={syncing}>
                    <RefreshCw className={cn(syncing && "animate-spin")} />
                    {s.refresh}
                  </Btn>
                  <Btn variant="ghost" size="sm" onClick={demo}>
                    {s.reconnect}
                  </Btn>
                  <Btn variant="ghost" size="sm" className="text-danger hover:bg-danger/10 hover:text-danger" onClick={demo}>
                    {s.disconnect}
                  </Btn>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState compact title={t.dashboard.emptyTitle} text={t.dashboard.emptyText} />
        )}
        <div className="mt-4 flex flex-wrap gap-2">
          <Btn variant="secondary" onClick={demo}>
            <PlatformIcon platform="meta" size="sm" />
            {s.connectMeta}
          </Btn>
          <Btn variant="secondary" onClick={demo}>
            <PlatformIcon platform="tiktok" size="sm" />
            {s.connectTikTok}
          </Btn>
        </div>
      </Section>

      <Section title={s.salesTitle}>
        <ul className="grid gap-3 md:grid-cols-3">
          {(
            [
              ["amocrm", <Workflow key="i" />, "blue"],
              ["bitrix24", <Workflow key="i" />, "coral"],
              ["sheets", <FileSpreadsheet key="i" />, "success"],
            ] as const
          ).map(([key, icon, tone]) => (
            <li key={key} className="flex flex-col gap-3 rounded-[20px] border border-border p-4">
              <div className="flex items-center gap-3">
                <IconPill tone={tone}>{icon}</IconPill>
                <p className="font-semibold">{s.salesItems[key].name}</p>
              </div>
              <p className="flex-1 text-sm text-muted-foreground">{s.salesItems[key].text}</p>
              <Btn variant="soft" size="sm" className="self-start" onClick={demo}>
                {t.common.connect}
              </Btn>
            </li>
          ))}
        </ul>
      </Section>

      {ds.syncRuns.length > 0 && (
        <Section title={s.runsTitle} bodyClassName="px-2 pt-2 pb-2 md:px-3">
          <ul>
            {ds.syncRuns.map((run) => {
              const account = ds.accounts.find((a) => a.id === run.accountId);
              return (
                <li key={run.id} className="flex min-h-13 items-center gap-3 rounded-2xl px-3 py-2 text-sm">
                  {account && <PlatformIcon platform={account.platform} size="sm" />}
                  <div className="min-w-0 flex-1">
                    <p className="num font-medium">{run.startedAt.slice(11)} · {formatDate(run.startedAt.slice(0, 10))}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {run.error ?? `${run.rows} ${s.run.rows} · ${run.durationSec} ${s.run.duration}`}
                    </p>
                  </div>
                  <Pill tone={run.status === "success" ? "success" : "danger"}>{s.run[run.status]}</Pill>
                </li>
              );
            })}
          </ul>
        </Section>
      )}
    </div>
  );
}

function LeadSources() {
  const s = t.settings.leadSources;
  const [origin, setOrigin] = useState("https://app.lightleads.kz");
  useEffect(() => setOrigin(window.location.origin), []);
  return (
    <div className="space-y-4 md:space-y-6">
      <Section title={s.utmTitle} hint={s.utmHint}>
        <div className="space-y-3">
          <CopyBlock text={UTM_TEMPLATES.meta} label={<><PlatformIcon platform="meta" size="sm" />{t.platform.meta}</>} />
          <CopyBlock text={UTM_TEMPLATES.tiktok} label={<><PlatformIcon platform="tiktok" size="sm" />{t.platform.tiktok}</>} />
        </div>
      </Section>
      <Section title={s.snippetTitle} hint={s.snippetHint}>
        <div className="max-h-72 overflow-auto rounded-2xl">
          <CopyBlock text={SITE_SNIPPET} multiline />
        </div>
      </Section>
      <Section title={s.webhookTitle} hint={s.webhookHint}>
        <div className="space-y-3">
          <CopyBlock text={`POST ${origin}${INGEST_PATH}`} />
          <CopyBlock text={DEMO_WORKSPACE_KEY} label={s.keyLabel} />
          <CopyBlock text={ingestExample(origin)} multiline />
        </div>
      </Section>
      <div className="grid gap-4 md:gap-6 lg:grid-cols-2">
        <Section title={s.formsTitle} hint={s.formsHint}>
          <ul className="space-y-2">
            {(
              [
                ["meta", s.formsMeta],
                ["tiktok", s.formsTikTok],
              ] as const
            ).map(([platform, label]) => (
              <li key={platform} className="flex min-h-13 items-center gap-3 rounded-2xl bg-muted/60 px-4">
                <PlatformIcon platform={platform} size="sm" />
                <span className="flex-1 text-sm font-medium">{label}</span>
                <Pill tone="success">{t.common.connected}</Pill>
              </li>
            ))}
          </ul>
        </Section>
        <Section title={s.whatsappTitle}>
          <div className="flex gap-3 rounded-2xl border border-warning/30 bg-warning/8 p-4 text-sm leading-relaxed">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" />
            <p>{s.whatsappWarning}</p>
          </div>
          <p className="mt-3 flex items-start gap-2 text-sm text-muted-foreground">
            <MessageCircle className="mt-0.5 size-4 shrink-0" />
            {s.instagramHint}
          </p>
        </Section>
      </div>
    </div>
  );
}

function Attribution() {
  const { settings, updateSettings, sales, attributions } = useApp();
  const s = t.settings.attribution;
  const attributed = sales.filter((sale) => attributions.get(sale.id)?.adId).length;
  return (
    <div className="space-y-4 md:space-y-6">
      <Section title={s.modelTitle} hint={s.modelHint}>
        <Segmented
          value={settings.attributionModel}
          onChange={(attributionModel) => updateSettings({ attributionModel })}
          full
          className="sm:inline-flex sm:w-auto"
          options={[
            { value: "last", label: s.last },
            { value: "first", label: s.first },
          ]}
        />
      </Section>
      <Section title={s.windowTitle} hint={s.windowHint}>
        <div className="flex flex-wrap gap-2">
          {ATTRIBUTION_WINDOWS.map((days) => (
            <Chip key={days} active={settings.attributionWindow === days} onClick={() => updateSettings({ attributionWindow: days })}>
              {s.days(days)}
            </Chip>
          ))}
        </div>
        <p className="num mt-4 rounded-2xl bg-brand-soft/70 px-4 py-3 text-sm">
          <b className="font-semibold">{s.impact({ attributed, total: sales.length })}</b> {s.liveNote}
        </p>
      </Section>
    </div>
  );
}

function CurrencySettings() {
  const { ds, today, currency, setCurrency, settings } = useApp();
  const s = t.settings.currency;
  const todayRate = rateOn(ds.rates, today);
  const history = Array.from({ length: RATE_HISTORY_DAYS }, (_, i) => {
    const date = addDays(today, -i);
    return { date, rate: rateOn(ds.rates, date).rate, fallback: !ds.rates[date] };
  });
  return (
    <div className="grid gap-4 md:gap-6 lg:grid-cols-2">
      <Section title={s.mainTitle} hint={s.mainHint}>
        <Segmented
          value={currency}
          onChange={setCurrency}
          full
          options={[
            { value: "USD", label: `${CURRENCY_SYMBOL.USD} USD` },
            { value: "KZT", label: `${CURRENCY_SYMBOL.KZT} KZT` },
          ]}
        />
        <div className="mt-5 rounded-2xl bg-muted/60 p-4">
          <p className="text-xs text-muted-foreground">{t.metric.spend}</p>
          <p className="num mt-1 text-xl font-semibold">{formatMoney(currency === "USD" ? SAMPLE_USD : SAMPLE_USD * todayRate.rate, currency)}</p>
          <p className="num mt-0.5 text-[11px] font-light text-subtle">
            {t.currency.approx} {formatMoney(currency === "USD" ? SAMPLE_USD * todayRate.rate : SAMPLE_USD, currency === "USD" ? "KZT" : "USD", { round: true })}
          </p>
        </div>
        <dl className="mt-4 flex items-center justify-between text-sm">
          <dt className="text-muted-foreground">{s.salesCurrency}</dt>
          <dd>
            <Pill tone="brand">
              {CURRENCY_SYMBOL[settings.salesCurrency]} {settings.salesCurrency}
            </Pill>
          </dd>
        </dl>
      </Section>

      <Section title={s.rateTitle} hint={s.rateHint}>
        <div className="rounded-2xl bg-brand-soft/70 p-4">
          <p className="text-xs text-accent-foreground">{s.rateToday}</p>
          <p className="num font-display mt-1 text-2xl font-semibold">1 USD = {formatNumber(todayRate.rate, RATE_DIGITS)} ₸</p>
        </div>
        <p className="mt-4 mb-1 text-xs font-medium text-muted-foreground">{s.history}</p>
        <ul className="num text-sm">
          {history.map((h) => (
            <li key={h.date} className="flex min-h-10 items-center justify-between border-b border-border last:border-0">
              <span className={cn(h.fallback && "text-subtle")}>{formatDate(h.date)}</span>
              <span className={cn("font-medium", h.fallback && "font-normal text-subtle")}>{formatNumber(h.rate, RATE_DIGITS)} ₸</span>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}

function Products() {
  const { products, addProduct, removeProduct, settings, updateSettings } = useApp();
  const s = t.settings.products;
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [cost, setCost] = useState("");
  const [costType, setCostType] = useState<Product["costType"]>("amount");
  const symbol = CURRENCY_SYMBOL[settings.salesCurrency];

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !Number(price)) return;
    addProduct({ name: name.trim(), price: Number(price), cost: Number(cost) || 0, costType });
    setName("");
    setPrice("");
    setCost("");
    toast.success(s.added);
  };

  return (
    <div className="grid gap-4 md:gap-6 lg:grid-cols-[1fr_360px]">
      <Section title={s.title} hint={s.hint} bodyClassName="px-2 pt-2 pb-2 md:px-3">
        {products.length ? (
          <ul>
            {products.map((p) => (
              <li key={p.id} className="flex min-h-14 items-center gap-3 rounded-2xl px-3 py-2 hover:bg-muted/60">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{p.name}</p>
                  <p className="num text-xs text-muted-foreground">
                    {s.cost}: {p.costType === "amount" ? formatMoney(p.cost, settings.salesCurrency) : `${p.cost}%`}
                  </p>
                </div>
                <span className="num text-sm font-semibold">{formatMoney(p.price, settings.salesCurrency)}</span>
                <button
                  type="button"
                  onClick={() => removeProduct(p.id)}
                  aria-label={t.common.remove}
                  className="inline-flex size-11 items-center justify-center rounded-xl text-subtle outline-none hover:bg-danger/10 hover:text-danger focus-visible:ring-4 focus-visible:ring-brand/25"
                >
                  <Trash2 className="size-4" />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState compact title={s.empty} />
        )}
      </Section>

      <div className="space-y-4 md:space-y-6">
        <Section title={s.addTitle}>
          <form onSubmit={submit} className="space-y-3">
            <Field label={s.name}>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={s.namePlaceholder} />
            </Field>
            <Field label={`${s.price}, ${symbol}`}>
              <Input inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value.replace(/\D/g, ""))} placeholder="0" className="num" />
            </Field>
            <Field label={s.cost}>
              <div className="flex gap-2">
                <Input inputMode="numeric" value={cost} onChange={(e) => setCost(e.target.value.replace(/\D/g, ""))} placeholder="0" className="num" />
                <Segmented
                  value={costType}
                  onChange={setCostType}
                  options={[
                    { value: "amount", label: symbol, ariaLabel: s.costAmount },
                    { value: "percent", label: "%", ariaLabel: s.costPercent },
                  ]}
                />
              </div>
            </Field>
            <Btn type="submit" className="w-full">
              <Plus />
              {t.common.add}
            </Btn>
          </form>
        </Section>
        <Section title={s.marginTitle} hint={s.marginHint}>
          <div className="flex items-center gap-3">
            <Input
              inputMode="numeric"
              value={settings.marginPct}
              onChange={(e) => updateSettings({ marginPct: Math.min(100, Number(e.target.value.replace(/\D/g, "")) || 0) })}
              className="num w-28 text-lg font-semibold"
            />
            <span className="text-lg font-semibold text-muted-foreground">%</span>
          </div>
        </Section>
      </div>
    </div>
  );
}

function Targets() {
  const { settings, updateSettings, analytics } = useApp();
  const s = t.settings.targets;
  const number = (v: string) => (v.replace(/\D/g, "") ? Number(v.replace(/\D/g, "")) : null);
  return (
    <div className="grid gap-4 md:gap-6 lg:grid-cols-2">
      <Section title={s.title} hint={s.hint}>
        <div className="space-y-4">
          <Field label={`${s.cac}, ${CURRENCY_SYMBOL[settings.salesCurrency]}`}>
            <Input
              inputMode="numeric"
              value={settings.targetCac === null ? "" : formatNumber(settings.targetCac)}
              placeholder={t.common.notSet}
              onChange={(e) => updateSettings({ targetCac: number(e.target.value) })}
              className="num text-lg font-semibold"
            />
          </Field>
          <Field label={s.romi}>
            <Input
              inputMode="numeric"
              value={settings.targetRomi ?? ""}
              placeholder={t.common.notSet}
              onChange={(e) => updateSettings({ targetRomi: number(e.target.value) })}
              className="num text-lg font-semibold"
            />
          </Field>
        </div>
      </Section>
      <Surface className="bg-brand-gradient flex flex-col justify-between gap-6 border-0 p-6 text-white shadow-brand">
        <div>
          <span className="inline-flex size-11 items-center justify-center rounded-2xl bg-white/20">
            <Sparkles className="size-5" />
          </span>
          <h2 className="font-display mt-4 text-[15px] font-semibold">{s.suggestTitle}</h2>
          <p className="mt-2 text-sm leading-relaxed text-white/85">
            {s.suggestText({ cac: formatMoney(analytics.suggested.cacKzt, "KZT"), romi: `${analytics.suggested.romiPct}%` })}
          </p>
        </div>
        <Btn
          variant="secondary"
          className="self-start border-0"
          onClick={() => {
            updateSettings({ targetCac: analytics.suggested.cacKzt, targetRomi: analytics.suggested.romiPct });
            toast.success(t.ai.targetsApplied);
          }}
        >
          {s.apply}
        </Btn>
      </Surface>
    </div>
  );
}

const emailSchema = z.email();

function Team() {
  const { members, inviteMember } = useApp();
  const s = t.settings.team;
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string>();
  const [origin, setOrigin] = useState("https://app.lightleads.kz");
  useEffect(() => setOrigin(window.location.origin), []);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!emailSchema.safeParse(email.trim()).success) {
      setError(s.emailError);
      return;
    }
    inviteMember(email.trim());
    setEmail("");
    setError(undefined);
    toast.success(s.invited);
    celebrate();
  };

  return (
    <div className="grid gap-4 md:gap-6 lg:grid-cols-[1fr_380px]">
      <Section title={s.title} hint={s.hint} bodyClassName="px-2 pt-2 pb-2 md:px-3">
        <ul>
          {members.map((m) => (
            <li key={m.id} className="flex min-h-16 items-center gap-3 rounded-2xl px-3 py-2">
              <WorkspaceAvatar name={m.name} className="rounded-full from-brand to-brand-2" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{m.name}</p>
                <p className="truncate text-xs text-muted-foreground">{m.email}</p>
              </div>
              {m.status === "invited" ? <Pill tone="warning">{s.statusInvited}</Pill> : <Pill tone={m.role === "owner" ? "brand" : "muted"}>{s.roles[m.role]}</Pill>}
            </li>
          ))}
        </ul>
      </Section>
      <Section title={s.invite}>
        <form onSubmit={submit} className="space-y-3">
          <Field label={t.auth.email} error={error}>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={s.invitePlaceholder} aria-invalid={Boolean(error)} />
          </Field>
          <Btn type="submit" className="w-full">
            {s.invite}
          </Btn>
        </form>
        <p className="mt-5 mb-1.5 text-xs font-medium text-muted-foreground">{s.inviteLink}</p>
        <CopyBlock text={`${origin}/invite/aroma-7f3k2`} />
      </Section>
    </div>
  );
}

function WorkspaceSettings() {
  const { workspace } = useApp();
  const s = t.settings.workspace;
  const [name, setName] = useState(workspace.name);
  const [theme, setTheme] = useTheme();
  useEffect(() => setName(workspace.name), [workspace.name]);
  return (
    <div className="grid gap-4 md:gap-6 lg:grid-cols-2">
      <Section title={s.themeTitle} hint={s.themeHint} className="lg:col-span-2">
        <div className="grid gap-2.5 sm:grid-cols-2">
          {THEMES.map((key) => {
            const active = theme === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setTheme(key)}
                aria-pressed={active}
                className={cn(
                  "flex min-h-16 items-center gap-3 rounded-2xl border p-3 text-left outline-none transition focus-visible:ring-4 focus-visible:ring-brand/25",
                  active ? "border-brand bg-brand-soft/60" : "border-border hover:border-brand/40",
                )}
              >
                <span className="size-10 shrink-0 rounded-[14px] shadow-card" style={{ background: THEME_SWATCH[key] }} />
                <span className="flex-1 text-sm font-semibold">{s.themes[key]}</span>
                {active && <Check className="size-5 text-brand" />}
              </button>
            );
          })}
        </div>
      </Section>
      <Section title={s.title}>
        <div className="space-y-4">
          <Field label={s.name}>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label={s.timezone}>
            <Input value={APP.timezone} readOnly className="text-muted-foreground" />
          </Field>
          <Btn onClick={() => toast.success(t.common.saved)}>{t.common.save}</Btn>
        </div>
      </Section>
      <Section title={s.dangerTitle} hint={s.dangerText}>
        <Btn variant="danger" disabled>
          <Trash2 />
          {s.delete}
        </Btn>
      </Section>
    </div>
  );
}

const PANELS: Record<Tab, () => ReactNode> = {
  connections: Connections,
  leadSources: LeadSources,
  attribution: Attribution,
  currency: CurrencySettings,
  products: Products,
  targets: Targets,
  team: Team,
  workspace: WorkspaceSettings,
};

export default function SettingsPage() {
  const { ready } = useApp();
  const [tab, setTab] = useState<Tab>("connections");
  if (!ready) return <PageSkeleton />;
  const Panel = PANELS[tab];
  return (
    <div className="space-y-4 md:space-y-6">
      <div className="-mx-4 px-4 md:mx-0 md:px-0">
        <Segmented value={tab} onChange={setTab} scroll options={TABS.map((key) => ({ value: key, label: t.settings.tabs[key] }))} />
      </div>
      <AnimatePresence mode="wait" initial={false}>
        <FadeIn key={tab}>
          <Panel />
        </FadeIn>
      </AnimatePresence>
    </div>
  );
}
