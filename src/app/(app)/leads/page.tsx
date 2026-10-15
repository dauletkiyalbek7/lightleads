"use client";

import { ClipboardList, FileSpreadsheet, Globe, Hand, MessageCircle, Plus, Send, Trash2, type LucideIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { LeadDialog } from "@/components/features/lead-dialog";
import { PlatformIcon } from "@/components/kit/brand";
import { Btn } from "@/components/kit/btn";
import { Picker, SearchInput } from "@/components/kit/field";
import { Modal } from "@/components/kit/overlay";
import { Pill } from "@/components/kit/pills";
import { Segmented } from "@/components/kit/segmented";
import { EmptyState, PageSkeleton } from "@/components/kit/states";
import { Surface } from "@/components/kit/surface";
import { plural, t } from "@/i18n";
import { formatDayShort, inRange } from "@/lib/dates";
import { formatPhone, whatsappLink } from "@/lib/phone";
import { useApp } from "@/lib/store";
import type { Lead, LeadSource } from "@/lib/types";

type StatusFilter = "all" | "sold" | "open";
const PAGE_SIZE = 40;
const LEAD_SOURCES_HREF = "/settings?tab=leadSources";
const SOURCES: LeadSource[] = ["meta_form", "tiktok_form", "website", "sheet", "whatsapp", "instagram", "manual"];
const SOURCE_ICON: Record<LeadSource, LucideIcon> = {
  meta_form: ClipboardList,
  tiktok_form: ClipboardList,
  website: Globe,
  sheet: FileSpreadsheet,
  whatsapp: MessageCircle,
  instagram: Send,
  manual: Hand,
};

function SourceLabel({ lead }: { lead: Lead }) {
  const Icon = SOURCE_ICON[lead.source];
  return (
    <span className="inline-flex items-center gap-1.5 text-sm whitespace-nowrap">
      {lead.platform ? <PlatformIcon platform={lead.platform} size="sm" /> : <Icon className="size-4 text-subtle" />}
      {t.leads.sources[lead.source]}
    </span>
  );
}

/** Открыть переписку с клиентом в WhatsApp на своём телефоне или в WhatsApp Web. */
function WhatsAppButton({ lead }: { lead: Lead }) {
  return (
    <a
      href={whatsappLink(lead.phone)}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={t.leads.writeWhatsApp}
      title={t.leads.writeWhatsApp}
      className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl text-success outline-none transition-colors hover:bg-success/10 focus-visible:ring-4 focus-visible:ring-brand/25"
    >
      <MessageCircle className="size-4" />
    </a>
  );
}

/** Первое сообщение клиента в WhatsApp: с ним менеджеру проще начать разговор. */
function LeadMessage({ lead, className }: { lead: Lead; className?: string }) {
  if (!lead.message) return null;
  return <p className={className}>«{lead.message}»</p>;
}

export default function LeadsPage() {
  const { ready, isEmpty, ds, sales, range, connectHref, deleteLead } = useApp();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [removing, setRemoving] = useState<Lead | null>(null);
  const [pending, setPending] = useState(false);
  const [query, setQuery] = useState("");
  const [source, setSource] = useState<LeadSource | "all">("all");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [limit, setLimit] = useState(PAGE_SIZE);

  const soldPhones = useMemo(() => new Set(sales.map((s) => s.phone)), [sales]);
  const adName = useMemo(() => new Map(ds.ads.map((a) => [a.id, a.name])), [ds.ads]);
  const campaignName = useMemo(() => new Map(ds.campaigns.map((c) => [c.id, c.name])), [ds.campaigns]);

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    const digits = q.replace(/\D/g, "");
    return ds.leads.filter((l) => {
      if (!inRange(l.date, range)) return false;
      if (source !== "all" && l.source !== source) return false;
      const sold = soldPhones.has(l.phone);
      if (status === "sold" && !sold) return false;
      if (status === "open" && sold) return false;
      if (!q) return true;
      return (digits.length > 2 && l.phone.includes(digits)) || l.name.toLowerCase().includes(q) || Boolean(l.message?.toLowerCase().includes(q));
    });
  }, [ds.leads, range, source, status, query, soldPhones]);

  const confirmRemove = async () => {
    if (!removing) return;
    setPending(true);
    const removed = await deleteLead(removing.id);
    setPending(false);
    setRemoving(null);
    if (removed) toast.success(t.leads.remove.done);
    else toast.error(t.leads.remove.failed);
  };

  if (!ready) return <PageSkeleton />;
  // Лиды могут приходить с сайта и до подключения рекламных кабинетов
  if (!ds.leads.length) {
    return (
      <Surface>
        {isEmpty ? (
          <EmptyState title={t.dashboard.emptyTitle} text={t.dashboard.emptyText} action={<Btn href={connectHref}>{t.dashboard.emptyAction}</Btn>} />
        ) : (
          <EmptyState
            title={t.leads.emptyTitle}
            text={t.leads.emptyText}
            action={
              <>
                <Btn href={LEAD_SOURCES_HREF}>{t.leads.emptyAction}</Btn>
                <Btn variant="secondary" onClick={() => setDialogOpen(true)}>
                  <Plus />
                  {t.leads.add}
                </Btn>
              </>
            }
          />
        )}
        <LeadDialog open={dialogOpen} onOpenChange={setDialogOpen} />
      </Surface>
    );
  }

  const shown = list.slice(0, limit);
  const StatusPill = ({ lead }: { lead: Lead }) =>
    soldPhones.has(lead.phone) ? <Pill tone="success">{t.leads.statusSold}</Pill> : <Pill>{t.leads.statusNoSale}</Pill>;

  const RemoveButton = ({ lead }: { lead: Lead }) => (
    <Btn variant="ghost" size="icon-sm" className="text-subtle hover:bg-danger/10 hover:text-danger" aria-label={t.common.remove} onClick={() => setRemoving(lead)}>
      <Trash2 />
    </Btn>
  );

  return (
    <div className="space-y-4">
      <LeadDialog open={dialogOpen} onOpenChange={setDialogOpen} />
      <Modal
        open={removing !== null}
        onOpenChange={(open) => !open && !pending && setRemoving(null)}
        title={t.leads.remove.title}
        footer={
          <div className="flex flex-wrap justify-end gap-2">
            <Btn variant="secondary" onClick={() => setRemoving(null)} disabled={pending}>
              {t.common.cancel}
            </Btn>
            <Btn variant="danger" onClick={confirmRemove} disabled={pending}>
              {t.leads.remove.confirm}
            </Btn>
          </div>
        }
      >
        <p className="text-sm leading-relaxed text-muted-foreground">{removing && t.leads.remove.text(formatPhone(removing.phone))}</p>
      </Modal>
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput
          placeholder={t.leads.searchPlaceholder}
          value={query}
          inputMode="search"
          onChange={(e) => setQuery(e.target.value)}
          className="min-w-0 flex-1 basis-full md:max-w-xs md:basis-auto [&_input]:md:h-10"
        />
        <Picker
          ariaLabel={t.leads.source}
          value={source}
          onChange={setSource}
          className="w-auto min-w-48 flex-1 md:flex-none md:data-[size=default]:h-10"
          options={[{ value: "all", label: t.leads.allSources }, ...SOURCES.map((s) => ({ value: s, label: t.leads.sources[s] }))]}
        />
        <Segmented
          value={status}
          onChange={setStatus}
          scroll
          options={[
            { value: "all", label: t.leads.statusAll },
            { value: "sold", label: t.leads.statusSold },
            { value: "open", label: t.leads.statusNoSale },
          ]}
        />
        <p className="num ml-auto hidden text-sm text-muted-foreground lg:block">{t.leads.found(list.length, plural(list.length, t.common.leadForms))}</p>
        <Btn variant="soft" className="md:h-10" onClick={() => setDialogOpen(true)}>
          <Plus />
          {t.leads.add}
        </Btn>
      </div>

      {!shown.length ? (
        <Surface>
          <EmptyState title={t.common.notFoundTitle} text={t.common.notFoundHint} />
        </Surface>
      ) : (
        <>
          <Surface className="hidden overflow-hidden md:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-muted-foreground">
                  <th className="px-5 py-3.5 text-left font-medium">{t.leads.date}</th>
                  <th className="px-4 py-3.5 text-left font-medium">{t.leads.lead}</th>
                  <th className="px-4 py-3.5 text-left font-medium">{t.leads.source}</th>
                  <th className="hidden px-4 py-3.5 text-left font-medium lg:table-cell">{t.leads.ad}</th>
                  <th className="px-4 py-3.5 text-right font-medium">{t.leads.status}</th>
                  <th className="w-24 py-3.5 pr-3" aria-label={t.common.remove} />
                </tr>
              </thead>
              <tbody>
                {shown.map((l) => (
                  <tr key={l.id} className="border-b border-border transition-colors last:border-0 hover:bg-muted/50">
                    <td className="num px-5 py-3 whitespace-nowrap text-muted-foreground">
                      {formatDayShort(l.date)}, {l.time}
                    </td>
                    <td className="px-4 py-3">
                      <p className="num font-medium whitespace-nowrap">{formatPhone(l.phone)}</p>
                      <p className="text-xs text-muted-foreground">{l.name}</p>
                      <LeadMessage lead={l} className="mt-0.5 line-clamp-2 max-w-80 text-xs text-subtle" />
                    </td>
                    <td className="px-4 py-3">
                      <SourceLabel lead={l} />
                    </td>
                    <td className="hidden max-w-72 px-4 py-3 lg:table-cell">
                      {l.adId ? (
                        <>
                          <p className="truncate font-medium">{adName.get(l.adId)}</p>
                          <p className="truncate text-xs text-muted-foreground">{campaignName.get(l.campaignId ?? "")}</p>
                        </>
                      ) : (
                        <span className="text-subtle">{t.leads.noAd}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <StatusPill lead={l} />
                    </td>
                    <td className="py-1.5 pr-3 text-right whitespace-nowrap">
                      <WhatsAppButton lead={l} />
                      <RemoveButton lead={l} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Surface>

          <ul className="space-y-2.5 md:hidden">
            {shown.map((l) => (
              <li key={l.id}>
                <Surface className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="num text-[15px] font-semibold">{formatPhone(l.phone)}</p>
                      <p className="text-xs text-muted-foreground">
                        {l.name && `${l.name} · `}
                        {formatDayShort(l.date)}, {l.time}
                      </p>
                    </div>
                    <StatusPill lead={l} />
                  </div>
                  <LeadMessage lead={l} className="mt-2 line-clamp-2 text-xs text-subtle" />
                  <div className="mt-3 flex items-center justify-between gap-3">
                    <SourceLabel lead={l} />
                    <span className="min-w-0 flex-1 truncate text-right text-xs text-muted-foreground">{l.adId ? adName.get(l.adId) : t.leads.noAd}</span>
                    <WhatsAppButton lead={l} />
                    <RemoveButton lead={l} />
                  </div>
                </Surface>
              </li>
            ))}
          </ul>

          <div className="flex flex-col items-center gap-2 pt-1">
            <p className="num text-xs text-subtle">
              {shown.length} / {t.leads.found(list.length, plural(list.length, t.common.leadForms))}
            </p>
            {list.length > limit && (
              <Btn variant="secondary" onClick={() => setLimit((n) => n + PAGE_SIZE)}>
                {t.common.showMore}
              </Btn>
            )}
          </div>
        </>
      )}
    </div>
  );
}
