"use client";

import { ArrowUpRight, MessageCircle, Phone } from "lucide-react";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { PlatformIcon } from "@/components/kit/brand";
import { Btn } from "@/components/kit/btn";
import { CreativeThumb } from "@/components/kit/creative-thumb";
import { inputClass } from "@/components/kit/field";
import { Modal } from "@/components/kit/overlay";
import { Pill } from "@/components/kit/pills";
import { t } from "@/i18n";
import { formatDate, formatDayShort } from "@/lib/dates";
import { formatMoney } from "@/lib/format";
import { leadDetails, type LeadDetails } from "@/lib/leads-api";
import { formatPhone, whatsappLink } from "@/lib/phone";
import { useApp } from "@/lib/store";
import type { Lead } from "@/lib/types";
import { cn } from "@/lib/utils";

/** Служебные поля заявки: они показаны в других блоках карточки или нужны только серверу. */
const HIDDEN_KEYS = new Set(["formid", "tranid", "cookies", "message", "referral", "phone_number_id", "page_id", "form_id", "field_data", "key"]);
const HIDDEN_PREFIXES = ["utm_", "ll_"];
/** Поля адреса страницы, с которой пришла заявка с сайта. */
const PAGE_KEYS = ["ll_page_url", "page_url", "referer"];
const MAX_VALUE_LENGTH = 300;

const digits = (value: string) => value.replace(/\D/g, "");

const stringify = (value: unknown): string => {
  if (Array.isArray(value)) return value.map(stringify).join(", ");
  if (value && typeof value === "object") return JSON.stringify(value);
  return String(value ?? "").slice(0, MAX_VALUE_LENGTH);
};

/** Ответы из формы: всё, что клиент заполнил, кроме имени и телефона — они уже в заголовке карточки. */
function formAnswers(lead: Lead, payload: Record<string, unknown>): [string, string][] {
  const fields: [string, unknown][] = Array.isArray(payload.field_data)
    ? (payload.field_data as { name?: string; values?: unknown }[]).map((f) => [f.name ?? "", f.values])
    : Object.entries(payload);
  const phoneDigits = digits(lead.phone);
  return fields.flatMap(([key, raw]) => {
    const lower = key.toLowerCase();
    if (!key || HIDDEN_KEYS.has(lower) || HIDDEN_PREFIXES.some((p) => lower.startsWith(p))) return [];
    const value = stringify(raw).trim();
    if (!value || value === lead.name || (digits(value).length > 6 && phoneDigits.endsWith(digits(value)))) return [];
    return [[key, value]];
  });
}

const pageUrl = (payload: Record<string, unknown>) => PAGE_KEYS.map((k) => payload[k]).find((v): v is string => typeof v === "string" && v.startsWith("http")) ?? null;

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2.5">
      <h3 className="text-xs font-medium tracking-wide text-subtle uppercase">{title}</h3>
      {children}
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-3">
      <dt className="shrink-0 text-[13px] text-muted-foreground sm:w-36">{label}</dt>
      <dd className="min-w-0 text-sm break-words">{children}</dd>
    </div>
  );
}

function ExternalLink({ href }: { href: string }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium text-brand hover:underline">
      <span className="break-all">{href.replace(/^https?:\/\//, "")}</span>
      <ArrowUpRight className="size-3.5 shrink-0" />
    </a>
  );
}

interface LeadCardProps {
  lead: Lead | null;
  onOpenChange: (open: boolean) => void;
}

/** Карточка лида: откуда пришёл, с какого объявления и креатива, что написал, продажи и комментарий менеджера. */
export function LeadCard({ lead, onOpenChange }: LeadCardProps) {
  const { ds, sales, demoMode, workspace, setLeadNote } = useApp();
  const realData = !demoMode && workspace.demoData === false;
  const [details, setDetails] = useState<LeadDetails | null>(null);
  const [loading, setLoading] = useState(false);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const leadId = lead?.id;
  useEffect(() => {
    setDetails(null);
    if (!leadId || !realData) return;
    let stale = false;
    setLoading(true);
    leadDetails(leadId).then((result) => {
      if (stale) return;
      setLoading(false);
      if (result) setDetails(result);
      else toast.error(t.leads.card.detailsFailed);
    });
    return () => {
      stale = true;
    };
  }, [leadId, realData]);

  useEffect(() => setNote(lead?.note ?? ""), [lead?.id, lead?.note]);

  if (!lead) return null;

  const s = t.leads.card;
  const ad = lead.adId ? ds.ads.find((a) => a.id === lead.adId) : undefined;
  const creative = ad ? ds.creatives.find((c) => c.id === ad.creativeId) : undefined;
  const campaign = ds.campaigns.find((c) => c.id === (ad?.campaignId ?? lead.campaignId));
  const adset = ds.adsets.find((a) => a.id === (ad?.adsetId ?? lead.adsetId));
  const leadSales = sales.filter((sale) => sale.phone === lead.phone);
  const productName = (id: string | null) => ds.products.find((p) => p.id === id)?.name ?? t.sales.noProduct;

  const payload = details?.payload ?? {};
  const referral = (payload.referral ?? {}) as { source_url?: string; headline?: string };
  const page = pageUrl(payload);
  const answers = formAnswers(lead, payload);
  const utm = Object.entries(details?.utm ?? {}).filter(([, v]) => v);
  const noteChanged = note.trim() !== (lead.note ?? "");

  const saveNote = async () => {
    setSaving(true);
    const ok = await setLeadNote(lead.id, note.trim());
    setSaving(false);
    if (ok) toast.success(s.noteSaved);
    else toast.error(s.noteFailed);
  };

  return (
    <Modal
      open
      onOpenChange={onOpenChange}
      size="lg"
      title={lead.name || formatPhone(lead.phone)}
      description={`${formatPhone(lead.phone)} · ${formatDayShort(lead.date)}, ${lead.time}`}
    >
      <div className="space-y-6">
        <div className="flex flex-wrap items-center gap-2">
          {leadSales.length ? <Pill tone="success">{t.leads.statusSold}</Pill> : <Pill>{t.leads.statusNoSale}</Pill>}
          <div className="flex gap-2 max-sm:w-full sm:ml-auto [&>*]:max-sm:flex-1">
            <Btn variant="secondary" size="sm" href={`tel:${lead.phone}`}>
              <Phone />
              {s.call}
            </Btn>
            <Btn variant="soft" size="sm" href={whatsappLink(lead.phone)} target="_blank" rel="noopener noreferrer">
              <MessageCircle />
              WhatsApp
            </Btn>
          </div>
        </div>

        {lead.message && (
          <Block title={s.message}>
            <p className="rounded-2xl bg-muted/60 px-4 py-3 text-sm leading-relaxed">«{lead.message}»</p>
          </Block>
        )}

        <Block title={s.origin}>
          <dl className="space-y-2">
            <Row label={s.source}>
              <span className="inline-flex items-center gap-1.5">
                {lead.platform && <PlatformIcon platform={lead.platform} size="sm" />}
                {t.leads.sources[lead.source]}
              </span>
            </Row>
            {details?.channel && (
              <Row label={details.channel.kind === "whatsapp" ? s.number : s.facebookPage}>
                {[details.channel.name, details.channel.detail].filter(Boolean).join(" · ")}
              </Row>
            )}
            {page && (
              <Row label={s.page}>
                <ExternalLink href={page} />
              </Row>
            )}
            {typeof payload.formid === "string" && <Row label={s.form}>{payload.formid}</Row>}
            {typeof payload.form_id === "string" && <Row label={s.form}>{payload.form_id}</Row>}
            {referral.source_url && (
              <Row label={s.adLink}>
                <ExternalLink href={referral.source_url} />
                {referral.headline && <span className="block text-xs text-muted-foreground">{referral.headline}</span>}
              </Row>
            )}
            {loading && <p className="text-xs text-subtle">{s.loading}</p>}
          </dl>
        </Block>

        <Block title={s.ad}>
          {ad ? (
            <div className="flex gap-4 rounded-2xl border border-border p-3">
              {creative && <CreativeThumb creative={creative} platform={ad.platform} variant="mini" className="size-20 rounded-2xl" />}
              <dl className="min-w-0 flex-1 space-y-1.5">
                <Row label={s.adName}>{ad.name}</Row>
                {adset && <Row label={s.adset}>{adset.name}</Row>}
                {campaign && <Row label={s.campaign}>{campaign.name}</Row>}
                <Link href={`/creatives/${ad.creativeId}`} className="inline-flex min-h-9 items-center gap-1 text-sm font-medium text-brand hover:underline">
                  {s.openCreative}
                  <ArrowUpRight className="size-3.5" />
                </Link>
              </dl>
            </div>
          ) : campaign ? (
            <dl className="space-y-1.5">
              <Row label={s.campaign}>{campaign.name}</Row>
              {adset && <Row label={s.adset}>{adset.name}</Row>}
            </dl>
          ) : (
            <p className="text-sm text-muted-foreground">{s.noAd}</p>
          )}
          {utm.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-1" aria-label={s.utm}>
              {utm.map(([key, value]) => (
                <span key={key} className="num rounded-lg bg-muted px-2 py-1 text-xs text-muted-foreground">
                  {key}=<span className="text-foreground">{value}</span>
                </span>
              ))}
            </div>
          )}
        </Block>

        {answers.length > 0 && (
          <Block title={s.answers}>
            <dl className="space-y-2">
              {answers.map(([key, value]) => (
                <Row key={key} label={key}>
                  {value}
                </Row>
              ))}
            </dl>
          </Block>
        )}

        <Block title={s.sales}>
          {leadSales.length ? (
            <ul className="space-y-1.5">
              {leadSales.map((sale) => (
                <li key={sale.id} className="flex items-center gap-3 rounded-2xl bg-muted/60 px-3.5 py-2.5 text-sm">
                  <span className="num text-muted-foreground">{formatDate(sale.date)}</span>
                  <span className="min-w-0 flex-1 truncate">{productName(sale.productId)}</span>
                  <span className="num font-semibold">{formatMoney(sale.amount, sale.currency)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">{s.noSales}</p>
          )}
        </Block>

        <Block title={s.note}>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={s.notePlaceholder}
            rows={3}
            className={cn(inputClass, "h-auto min-h-24 resize-y py-2.5 leading-relaxed")}
          />
          <Btn size="sm" onClick={saveNote} disabled={!noteChanged || saving}>
            {s.noteSave}
          </Btn>
        </Block>
      </div>
    </Modal>
  );
}
