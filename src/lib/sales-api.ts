import { getBrowserSupabase } from "./supabase/client";
import { PRODUCT_COLUMNS, rowToProduct, rowToSale, SALE_COLUMNS, type ProductRow, type SaleRow } from "./supabase/dataset";
import type { Product, Sale } from "./types";

/**
 * Продажи и товары в базе. Запись идёт напрямую в таблицы: права проверяет RLS
 * (продажи вносит любой участник workspace, товары ведёт владелец).
 */
const INSERT_CHUNK = 500;

/** Сохраняет продажи и возвращает их с идентификаторами из базы. null — база отказала. */
export async function salesInsert(workspaceId: string, list: Omit<Sale, "id">[]): Promise<Sale[] | null> {
  const created: Sale[] = [];
  for (let from = 0; from < list.length; from += INSERT_CHUNK) {
    const rows = list.slice(from, from + INSERT_CHUNK).map((sale) => ({
      workspace_id: workspaceId,
      phone: sale.phone,
      customer_name: sale.customerName,
      amount: sale.amount,
      currency: sale.currency,
      product_id: sale.productId,
      cost: sale.cost,
      sold_on: sale.date,
      comment: sale.comment,
      input: sale.input,
      manual_ad_id: sale.manualAdId,
    }));
    const { data, error } = await getBrowserSupabase().from("sales").insert(rows).select(SALE_COLUMNS).returns<SaleRow[]>();
    if (error || !data) return null;
    created.push(...data.map(rowToSale));
  }
  return created;
}

/** Источник, выбранный менеджером вручную. */
export async function saleSetSource(id: string, manualAdId: string | null): Promise<boolean> {
  const { data, error } = await getBrowserSupabase().from("sales").update({ manual_ad_id: manualAdId }).eq("id", id).select("id");
  return !error && (data?.length ?? 0) > 0;
}

export async function saleDelete(id: string): Promise<boolean> {
  const { data, error } = await getBrowserSupabase().from("sales").delete().eq("id", id).select("id");
  return !error && (data?.length ?? 0) > 0;
}

export async function productInsert(workspaceId: string, product: Omit<Product, "id">): Promise<Product | null> {
  const { data, error } = await getBrowserSupabase()
    .from("products")
    .insert({ workspace_id: workspaceId, name: product.name, price: product.price, cost_type: product.costType, cost: product.cost })
    .select(PRODUCT_COLUMNS)
    .single<ProductRow>();
  return error || !data ? null : rowToProduct(data);
}

/** Товар не удаляется, а уходит в архив: на него ссылаются продажи. */
export async function productArchive(id: string): Promise<boolean> {
  const { data, error } = await getBrowserSupabase().from("products").update({ archived_at: new Date().toISOString() }).eq("id", id).select("id");
  return !error && (data?.length ?? 0) > 0;
}
