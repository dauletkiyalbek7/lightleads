"use client";

import { CircleCheck, FileSpreadsheet, Upload } from "lucide-react";
import { useMemo, useRef, useState, type DragEvent } from "react";
import { toast } from "sonner";
import { Btn } from "@/components/kit/btn";
import { Picker } from "@/components/kit/field";
import { Modal } from "@/components/kit/overlay";
import { Pill } from "@/components/kit/pills";
import { Switch } from "@/components/ui/switch";
import { plural, t } from "@/i18n";
import { attributeSale, indexLeadsByPhone } from "@/lib/attribution";
import { celebrate } from "@/lib/confetti";
import { evaluateRows, guessMapping, parseCsv, REQUIRED_FIELDS, rowToSale, type CsvTable, type ImportField, type Mapping } from "@/lib/csv";
import { parseXlsx } from "@/lib/xlsx";
import { addDays, formatDate } from "@/lib/dates";
import { formatInt } from "@/lib/format";
import { formatPhone } from "@/lib/phone";
import { useApp } from "@/lib/store";
import { cn } from "@/lib/utils";

const FIELDS: ImportField[] = ["phone", "amount", "date", "product"];
const NOT_MAPPED = "none";
const XLSX_RE = /\.xlsx$/i;
const PREVIEW_ROWS = 8;
const STATUS_TONE = { ok: "success", bad: "danger", duplicate: "warning" } as const;
const STATUS_LABEL = { ok: t.sales.importer.rowOk, bad: t.sales.importer.rowBad, duplicate: t.sales.importer.rowDup } as const;

interface Result {
  imported: number;
  attributed: number;
  skipped: number;
}

/** Мастер импорта: файл → сопоставление колонок → предпросмотр и отчёт о дублях → готово. */
export function SalesImporter({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { ds, sales, products, settings, today, addSales } = useApp();
  const [step, setStep] = useState(0);
  const [table, setTable] = useState<CsvTable | null>(null);
  const [mapping, setMapping] = useState<Mapping>({ phone: null, amount: null, date: null, product: null });
  const [skipDuplicates, setSkipDuplicates] = useState(true);
  const [result, setResult] = useState<Result | null>(null);
  const [pending, setPending] = useState(false);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const rows = useMemo(() => (table ? evaluateRows(table, mapping, sales, today) : []), [table, mapping, sales, today]);
  const counts = useMemo(
    () => ({
      ok: rows.filter((r) => r.status === "ok").length,
      bad: rows.filter((r) => r.status === "bad").length,
      duplicate: rows.filter((r) => r.status === "duplicate").length,
    }),
    [rows],
  );
  const toImport = rows.filter((r) => r.status === "ok" || (r.status === "duplicate" && !skipDuplicates));
  const mappingReady = REQUIRED_FIELDS.every((f) => mapping[f] !== null);

  const reset = () => {
    setStep(0);
    setTable(null);
    setResult(null);
    setSkipDuplicates(true);
  };
  const close = (next: boolean) => {
    onOpenChange(next);
    if (!next) window.setTimeout(reset, 250);
  };

  const show = (parsed: CsvTable | null) => {
    if (!parsed) {
      toast.error(t.sales.importer.parseError);
      return;
    }
    setTable(parsed);
    setMapping(guessMapping(parsed.headers));
    setStep(1);
  };
  const load = (text: string) => show(parseCsv(text));
  const onFile = async (file?: File) => {
    if (!file) return;
    if (XLSX_RE.test(file.name)) show(await parseXlsx(file));
    else load(await file.text());
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    onFile(e.dataTransfer.files[0]);
  };

  /** Пример: номера в разных форматах, один дубль и одна строка с ошибкой. */
  const loadSample = () => {
    const known = ds.leads.filter((l) => l.adId).slice(40, 45);
    const raw = (phone: string, i: number) =>
      [`8 ${phone.slice(2, 5)} ${phone.slice(5, 8)} ${phone.slice(8, 10)} ${phone.slice(10)}`, `+7 (${phone.slice(2, 5)}) ${phone.slice(5, 8)}-${phone.slice(8, 10)}-${phone.slice(10)}`, phone.slice(1)][i % 3];
    const dup = sales[0];
    const lines = [
      "Телефон;Сумма;Дата;Товар",
      ...known.map((l, i) => `${raw(l.phone, i)};${products[i % products.length]?.price ?? 25000};${formatDate(addDays(today, -i))};${products[i % products.length]?.name ?? ""}`),
      `8 705 555 01 01;41 000 ₸;${formatDate(addDays(today, -2))};`,
      `+7 777 000 12 34;18500;${formatDate(addDays(today, -4))};${products[2]?.name ?? ""}`,
      ...(dup ? [`${dup.phone};${dup.amount};${formatDate(dup.date)};`] : []),
      `12345;abc;${formatDate(today)};`,
    ];
    load(lines.join("\n"));
  };

  const runImport = async () => {
    if (pending) return;
    const byPhone = indexLeadsByPhone(ds.leads);
    const list = toImport.map((r) => rowToSale(r, products, settings.marginPct, settings.salesCurrency));
    const attributed = list.filter(
      (s) =>
        attributeSale({ id: "x", phone: s.phone, date: s.date, manualAdId: null }, byPhone, {
          model: settings.attributionModel,
          windowDays: settings.attributionWindow,
        }).lead,
    ).length;
    setPending(true);
    const saved = await addSales(list);
    setPending(false);
    if (!saved) return;
    setResult({ imported: list.length, attributed, skipped: rows.length - list.length });
    setStep(3);
    celebrate();
  };

  const footer =
    step === 1 ? (
      <div className="flex gap-2">
        <Btn variant="secondary" onClick={reset}>
          {t.common.back}
        </Btn>
        <Btn className="flex-1" disabled={!mappingReady} onClick={() => setStep(2)}>
          {t.common.next}
        </Btn>
      </div>
    ) : step === 2 ? (
      <div className="flex gap-2">
        <Btn variant="secondary" onClick={() => setStep(1)}>
          {t.common.back}
        </Btn>
        <Btn className="flex-1" disabled={!toImport.length || pending} onClick={runImport}>
          {t.sales.importer.importN(toImport.length)}
        </Btn>
      </div>
    ) : step === 3 ? (
      <Btn className="w-full" onClick={() => close(false)}>
        {t.common.done}
      </Btn>
    ) : undefined;

  return (
    <Modal open={open} onOpenChange={close} title={t.sales.importer.title} size="lg" footer={footer}>
      <ol className="mb-5 flex items-center gap-2">
        {t.sales.importer.steps.map((label, i) => (
          <li key={label} className="flex flex-1 flex-col gap-1.5">
            <span className={cn("h-1.5 rounded-full transition-colors duration-300", i <= step ? "bg-brand-gradient" : "bg-muted")} />
            <span className={cn("text-xs font-medium", i === step ? "text-foreground" : "text-subtle")}>{label}</span>
          </li>
        ))}
      </ol>

      {step === 0 && (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={cn(
            "flex flex-col items-center rounded-[20px] border-2 border-dashed px-6 py-10 text-center transition-colors",
            dragging ? "border-brand bg-brand-soft" : "border-border bg-muted/40",
          )}
        >
          <span className="inline-flex size-14 items-center justify-center rounded-2xl bg-brand-soft text-brand">
            <Upload className="size-6" />
          </span>
          <p className="mt-4 font-semibold">{t.sales.importer.drop}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t.sales.importer.formats}</p>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            <Btn onClick={() => fileRef.current?.click()}>{t.sales.importer.choose}</Btn>
            <Btn variant="secondary" onClick={loadSample}>
              <FileSpreadsheet />
              {t.sales.importer.sample}
            </Btn>
          </div>
          <input ref={fileRef} type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden onChange={(e) => onFile(e.target.files?.[0])} />
        </div>
      )}

      {step === 1 && table && (
        <div className="space-y-3">
          <p className="text-sm font-semibold">{t.sales.importer.mapTitle}</p>
          {FIELDS.map((field) => (
            <div key={field} className="grid grid-cols-[1fr_1.4fr] items-center gap-3">
              <span className="text-sm">
                {t.sales.importer.fields[field]}
                {REQUIRED_FIELDS.includes(field) && <span className="ml-1.5 text-xs text-subtle">{t.sales.importer.required}</span>}
              </span>
              <Picker
                value={mapping[field] === null ? NOT_MAPPED : String(mapping[field])}
                onChange={(v) => setMapping((m) => ({ ...m, [field]: v === NOT_MAPPED ? null : Number(v) }))}
                options={[
                  { value: NOT_MAPPED, label: t.sales.importer.notMapped },
                  ...table.headers.map((h, i) => ({ value: String(i), label: h || `#${i + 1}` })),
                ]}
              />
            </div>
          ))}
        </div>
      )}

      {step === 2 && (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-2.5">
            {(
              [
                ["ok", t.sales.importer.valid],
                ["duplicate", t.sales.importer.duplicates],
                ["bad", t.sales.importer.invalid],
              ] as const
            ).map(([key, label]) => (
              <div key={key} className="rounded-2xl bg-muted/60 p-3.5">
                <p className="text-xs text-muted-foreground">{label}</p>
                <p className="num font-display mt-1 text-xl font-semibold">{formatInt(counts[key])}</p>
              </div>
            ))}
          </div>

          <div className="overflow-x-auto rounded-2xl border border-border">
            <table className="num w-full text-sm">
              <thead className="bg-muted text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2.5 text-left font-medium">#</th>
                  {FIELDS.map((f) => (
                    <th key={f} className="px-3 py-2.5 text-left font-medium">
                      {t.sales.importer.fields[f]}
                    </th>
                  ))}
                  <th className="px-3 py-2.5 text-right font-medium">{t.leads.status}</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, PREVIEW_ROWS).map((r) => (
                  <tr key={r.line} className="border-t border-border">
                    <td className="px-3 py-2 text-subtle">{r.line}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{r.phone ? formatPhone(r.phone) : <span className="text-danger">{r.rawPhone || "—"}</span>}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{r.amount ? formatInt(r.amount) : <span className="text-danger">—</span>}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{r.date ? formatDate(r.date) : <span className="text-danger">—</span>}</td>
                    <td className="max-w-40 truncate px-3 py-2 text-muted-foreground">{r.productName || "—"}</td>
                    <td className="px-3 py-2 text-right">
                      <Pill tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Pill>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {counts.bad > 0 && <p className="text-[13px] text-muted-foreground">{t.sales.importer.invalidHint}</p>}
          {counts.duplicate > 0 && (
            <div className="rounded-2xl border border-warning/30 bg-warning/8 p-3.5">
              <p className="text-[13px] leading-snug">{t.sales.importer.duplicatesHint}</p>
              <label className="mt-2 flex min-h-10 cursor-pointer items-center justify-between gap-3 text-sm font-medium">
                {t.sales.importer.skipDuplicates}
                <Switch checked={skipDuplicates} onCheckedChange={setSkipDuplicates} />
              </label>
            </div>
          )}
        </div>
      )}

      {step === 3 && result && (
        <div className="flex flex-col items-center py-8 text-center">
          <span className="inline-flex size-16 items-center justify-center rounded-full bg-success/12 text-success">
            <CircleCheck className="size-8" />
          </span>
          <p className="font-display mt-4 text-lg font-semibold">
            {t.sales.importer.doneTitle(result.imported, plural(result.imported, t.common.saleForms))}
          </p>
          <p className="mt-2 max-w-sm text-sm text-muted-foreground">
            {t.sales.importer.doneText({
              attributed: result.attributed,
              unattributed: result.imported - result.attributed,
              skipped: result.skipped,
            })}
          </p>
        </div>
      )}
    </Modal>
  );
}
