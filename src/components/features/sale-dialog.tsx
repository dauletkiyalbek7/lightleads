"use client";

import { AnimatePresence, motion } from "framer-motion";
import { CircleCheck, Search, TriangleAlert } from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { Btn } from "@/components/kit/btn";
import { CreativeThumb } from "@/components/kit/creative-thumb";
import { Field, Input, inputClass, Picker } from "@/components/kit/field";
import { Modal } from "@/components/kit/overlay";
import { plural, t } from "@/i18n";
import { attributeSale, findDuplicate, indexLeadsByPhone } from "@/lib/attribution";
import { celebrate } from "@/lib/confetti";
import { diffDays, formatDate } from "@/lib/dates";
import { CURRENCY_SYMBOL, formatNumber } from "@/lib/format";
import { agoLabel } from "@/lib/labels";
import { formatPhoneInput, normalizePhone } from "@/lib/phone";
import { useApp } from "@/lib/store";
import type { Dataset, Product } from "@/lib/types";
import { cn } from "@/lib/utils";

const NO_PRODUCT = "none";
const NO_AD = "none";
const PERCENT = 100;

const digitsOnly = (s: string) => s.replace(/\D/g, "");
const productCost = (p: Product) => Math.round(p.costType === "amount" ? p.cost : (p.price * p.cost) / PERCENT);

/** Список объявлений для ручного выбора источника. */
export function useAdOptions(ds: Dataset) {
  return useMemo(() => {
    const campaigns = new Map(ds.campaigns.map((c) => [c.id, c.name]));
    return [
      { value: NO_AD, label: t.sales.unknownSource },
      ...ds.ads.map((ad) => ({ value: ad.id, label: `${ad.name} · ${campaigns.get(ad.campaignId) ?? ""}` })),
    ];
  }, [ds]);
}
export { NO_AD };

type Errors = Partial<Record<"phone" | "amount" | "date", string>>;

/**
 * Быстрое добавление продажи — главный сценарий, 10–15 секунд с телефона.
 * Сразу после ввода номера показываем найденный источник.
 */
export function SaleDialog() {
  const { saleDialogOpen, setSaleDialogOpen, ds, products, sales, settings, today, addSales, members } = useApp();
  const [phone, setPhone] = useState("");
  const [pending, setPending] = useState(false);
  const [amount, setAmount] = useState("");
  const [productId, setProductId] = useState(NO_PRODUCT);
  const [cost, setCost] = useState("");
  const [costTouched, setCostTouched] = useState(false);
  const [date, setDate] = useState(today);
  const [comment, setComment] = useState("");
  const [manualAdId, setManualAdId] = useState(NO_AD);
  const [errors, setErrors] = useState<Errors>({});

  useEffect(() => {
    if (!saleDialogOpen) return;
    setPhone("");
    setAmount("");
    setProductId(NO_PRODUCT);
    setCost("");
    setCostTouched(false);
    setDate(today);
    setComment("");
    setManualAdId(NO_AD);
    setErrors({});
  }, [saleDialogOpen, today]);

  const leadsByPhone = useMemo(() => indexLeadsByPhone(ds.leads), [ds.leads]);
  const adOptions = useAdOptions(ds);
  const normalized = normalizePhone(phone);
  const amountValue = Number(amount) || 0;
  const product = products.find((p) => p.id === productId) ?? null;

  const attribution = useMemo(
    () =>
      normalized
        ? attributeSale({ id: "draft", phone: normalized, date, manualAdId: null }, leadsByPhone, {
            model: settings.attributionModel,
            windowDays: settings.attributionWindow,
          })
        : null,
    [normalized, date, leadsByPhone, settings.attributionModel, settings.attributionWindow],
  );
  const foundAd = attribution?.lead?.adId ? ds.ads.find((a) => a.id === attribution.lead!.adId) : null;
  const foundCreative = foundAd ? ds.creatives.find((c) => c.id === foundAd.creativeId) : null;
  const duplicate = normalized && amountValue > 0 ? findDuplicate({ phone: normalized, amount: amountValue, date }, sales) : null;

  // Себестоимость подставляется из товара, а без товара — по средней марже.
  const autoCost = product ? productCost(product) : Math.round(amountValue * (1 - settings.marginPct / PERCENT));
  const costValue = costTouched ? Number(cost) || 0 : autoCost;

  const onProduct = (id: string) => {
    setProductId(id);
    setCostTouched(false);
    const next = products.find((p) => p.id === id);
    if (next) setAmount(String(next.price));
  };

  const schema = z.object({
    phone: z.string().refine((v) => normalizePhone(v) !== null, t.sales.form.errors.phone),
    amount: z.number().positive(t.sales.form.errors.amount),
    date: z
      .string()
      .min(1, t.sales.form.errors.date)
      .refine((v) => v <= today, t.sales.form.errors.future),
  });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (pending) return;
    const parsed = schema.safeParse({ phone, amount: amountValue, date });
    if (!parsed.success) {
      const next: Errors = {};
      for (const issue of parsed.error.issues) next[issue.path[0] as keyof Errors] ??= issue.message;
      setErrors(next);
      return;
    }
    const hasLead = Boolean(attribution?.lead);
    setPending(true);
    const saved = await addSales([
      {
        phone: normalized!,
        customerName: attribution?.lead?.name ?? "",
        amount: amountValue,
        currency: settings.salesCurrency,
        productId: product?.id ?? null,
        cost: costValue,
        date,
        comment: comment.trim(),
        input: "manual",
        manualAdId: !hasLead && manualAdId !== NO_AD ? manualAdId : null,
        createdBy: members[0]?.name ?? "",
      },
    ]);
    setPending(false);
    // Не сохранилось: окно остаётся открытым, введённое не пропадает
    if (!saved) return;
    setSaleDialogOpen(false);
    celebrate();
    const manualAd = ds.ads.find((a) => a.id === manualAdId);
    toast.success(t.sales.form.success, {
      description: foundAd
        ? t.sales.form.successSource(foundAd.name)
        : manualAd
          ? t.sales.form.successSource(manualAd.name)
          : t.sales.form.successNoSource,
    });
  };

  const symbol = CURRENCY_SYMBOL[settings.salesCurrency];

  return (
    <Modal
      open={saleDialogOpen}
      onOpenChange={setSaleDialogOpen}
      title={t.sales.form.title}
      description={t.sales.form.subtitle}
      footer={
        <Btn type="submit" form="sale-form" size="lg" className="w-full" disabled={pending}>
          {t.sales.form.submit}
        </Btn>
      }
    >
      <form id="sale-form" onSubmit={submit} className="space-y-4 pt-1" noValidate>
        <Field label={t.sales.form.phone} error={errors.phone}>
          <Input
            type="tel"
            inputMode="tel"
            autoComplete="off"
            autoFocus
            placeholder={t.sales.form.phonePlaceholder}
            value={phone}
            aria-invalid={Boolean(errors.phone)}
            onChange={(e) => {
              setPhone(formatPhoneInput(e.target.value));
              setErrors((s) => ({ ...s, phone: undefined }));
            }}
            className="num h-13 text-lg font-semibold md:text-lg"
          />
        </Field>

        {/* Найденный источник — сразу после ввода номера */}
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={!normalized ? "typing" : foundAd ? `found-${foundAd.id}` : "none"}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.18 }}
          >
            {!normalized ? (
              <div className="flex items-center gap-3 rounded-2xl bg-muted/70 px-4 py-3 text-sm text-muted-foreground">
                <Search className="size-4 shrink-0" />
                {t.sales.form.typing}
              </div>
            ) : foundAd && foundCreative && attribution?.lead ? (
              <div className="flex items-center gap-3 rounded-2xl border border-success/25 bg-success/8 p-3">
                <CreativeThumb creative={foundCreative} variant="mini" />
                <div className="min-w-0 flex-1 text-sm leading-snug">
                  <p className="font-semibold">
                    {t.sales.form.found({
                      ad: foundAd.name,
                      platform: t.platform[foundAd.platform],
                      ago: agoLabel(diffDays(date, attribution.lead.date)),
                    })}
                  </p>
                  {attribution.history.length > 1 && (
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {t.sales.form.foundTouches(attribution.history.length, plural(attribution.history.length, t.common.touchForms))}
                    </p>
                  )}
                </div>
                <CircleCheck className="size-5 shrink-0 text-success" />
              </div>
            ) : (
              <div className="space-y-3 rounded-2xl border border-warning/30 bg-warning/8 p-3.5">
                <div className="flex gap-2.5 text-sm leading-snug">
                  <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" />
                  <p>{t.sales.form.notFound}</p>
                </div>
                <Picker value={manualAdId} onChange={setManualAdId} options={adOptions} ariaLabel={t.sales.chooseSource} />
              </div>
            )}
          </motion.div>
        </AnimatePresence>

        <div className="grid grid-cols-2 gap-3">
          <Field label={`${t.sales.form.amount}, ${symbol}`} error={errors.amount}>
            <Input
              inputMode="numeric"
              autoComplete="off"
              placeholder="0"
              value={amount ? formatNumber(Number(amount)) : ""}
              aria-invalid={Boolean(errors.amount)}
              onChange={(e) => {
                setAmount(digitsOnly(e.target.value));
                setErrors((s) => ({ ...s, amount: undefined }));
              }}
              className="num font-semibold"
            />
          </Field>
          <Field label={t.sales.form.date} error={errors.date}>
            <input
              type="date"
              value={date}
              max={today}
              aria-invalid={Boolean(errors.date)}
              onChange={(e) => setDate(e.target.value)}
              className={cn(inputClass, "num")}
            />
          </Field>
        </div>

        <Field label={t.sales.form.product}>
          <Picker
            value={productId}
            onChange={onProduct}
            options={[
              { value: NO_PRODUCT, label: t.sales.form.productNone },
              ...products.map((p) => ({ value: p.id, label: `${p.name} · ${formatNumber(p.price)} ${symbol}` })),
            ]}
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field
            label={`${t.sales.form.cost}, ${symbol}`}
            hint={!product && !costTouched ? t.sales.form.costHint({ margin: settings.marginPct }) : undefined}
            className="col-span-2 sm:col-span-1"
          >
            <Input
              inputMode="numeric"
              autoComplete="off"
              value={costValue ? formatNumber(costValue) : ""}
              placeholder="0"
              onChange={(e) => {
                setCost(digitsOnly(e.target.value));
                setCostTouched(true);
              }}
              className="num"
            />
          </Field>
          <Field label={t.sales.form.comment} className="col-span-2 sm:col-span-1">
            <Input value={comment} onChange={(e) => setComment(e.target.value)} placeholder={t.sales.form.commentPlaceholder} />
          </Field>
        </div>

        {duplicate && (
          <div className="flex gap-2.5 rounded-2xl border border-warning/30 bg-warning/8 p-3.5 text-sm leading-snug">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" />
            <p>{t.sales.duplicateHint({ date: formatDate(duplicate.date), input: t.sales.inputs[duplicate.input] })}</p>
          </div>
        )}
      </form>
    </Modal>
  );
}
