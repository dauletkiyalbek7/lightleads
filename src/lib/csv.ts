import { findDuplicate } from "./attribution";
import { normalizePhone } from "./phone";
import type { Product, Sale } from "./types";

export interface CsvTable {
  headers: string[];
  rows: string[][];
}

const DELIMITERS = [";", ",", "\t"] as const;

function splitLine(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = !quoted;
    } else if (ch === delimiter && !quoted) {
      cells.push(cell.trim());
      cell = "";
    } else cell += ch;
  }
  cells.push(cell.trim());
  return cells;
}

/** Простой разбор CSV: заголовки в первой строке, разделитель определяется автоматически. */
export function parseCsv(text: string): CsvTable | null {
  const lines = text
    .replace(/^﻿/, "")
    .split(/\r?\n/)
    .filter((l) => l.trim());
  if (lines.length < 2) return null;
  const delimiter = DELIMITERS.reduce((best, d) => (lines[0].split(d).length > lines[0].split(best).length ? d : best));
  const headers = splitLine(lines[0], delimiter);
  if (headers.length < 2) return null;
  return { headers, rows: lines.slice(1).map((l) => splitLine(l, delimiter)) };
}

export type ImportField = "phone" | "amount" | "date" | "product";
export type Mapping = Record<ImportField, number | null>;
export const REQUIRED_FIELDS: ImportField[] = ["phone", "amount", "date"];

const HEADER_HINTS: Record<ImportField, string[]> = {
  phone: ["тел", "phone", "номер"],
  amount: ["сум", "amount", "цена", "оплат", "price"],
  date: ["дат", "date"],
  product: ["товар", "product", "услуг", "наимен"],
};

export function guessMapping(headers: string[]): Mapping {
  const find = (field: ImportField) => {
    const i = headers.findIndex((h) => HEADER_HINTS[field].some((hint) => h.toLowerCase().includes(hint)));
    return i >= 0 ? i : null;
  };
  return { phone: find("phone"), amount: find("amount"), date: find("date"), product: find("product") };
}

/** «12.10.2026» или «2026-10-12» → yyyy-MM-dd */
function parseDate(raw: string): string | null {
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const local = /^(\d{1,2})[./](\d{1,2})[./](\d{4})/.exec(raw);
  if (local) return `${local[3]}-${local[2].padStart(2, "0")}-${local[1].padStart(2, "0")}`;
  return null;
}

function parseAmount(raw: string): number | null {
  const n = Number(raw.replace(/[^\d.,-]/g, "").replace(",", "."));
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

export interface ImportRow {
  line: number;
  rawPhone: string;
  phone: string | null;
  amount: number | null;
  date: string | null;
  productName: string;
  status: "ok" | "bad" | "duplicate";
}

export function evaluateRows(table: CsvTable, mapping: Mapping, existing: Sale[], today: string): ImportRow[] {
  const cell = (row: string[], field: ImportField) => (mapping[field] === null ? "" : (row[mapping[field]] ?? ""));
  const accepted: Sale[] = [];
  return table.rows.map((row, i) => {
    const rawPhone = cell(row, "phone");
    const phone = normalizePhone(rawPhone);
    const amount = parseAmount(cell(row, "amount"));
    const date = parseDate(cell(row, "date"));
    const valid = phone !== null && amount !== null && date !== null && date <= today;
    let status: ImportRow["status"] = valid ? "ok" : "bad";
    if (valid) {
      const candidate = { phone, amount, date };
      // Дубли ищем и среди уже внесённых продаж, и внутри самого файла.
      if (findDuplicate(candidate, existing) || findDuplicate(candidate, accepted)) status = "duplicate";
      accepted.push({ ...candidate, id: `row_${i}` } as Sale);
    }
    return { line: i + 2, rawPhone, phone, amount, date, productName: cell(row, "product"), status };
  });
}

const PERCENT = 100;

export function rowToSale(row: ImportRow, products: Product[], marginPct: number, currency: Sale["currency"]): Omit<Sale, "id"> {
  const product = products.find((p) => p.name.toLowerCase() === row.productName.trim().toLowerCase()) ?? null;
  const amount = row.amount ?? 0;
  const cost = product
    ? Math.round(product.costType === "amount" ? product.cost : (product.price * product.cost) / PERCENT)
    : Math.round(amount * (1 - marginPct / PERCENT));
  return {
    phone: row.phone ?? "",
    customerName: "",
    amount,
    currency,
    productId: product?.id ?? null,
    cost,
    date: row.date ?? "",
    comment: "",
    input: "csv",
    manualAdId: null,
    createdBy: "—",
  };
}
