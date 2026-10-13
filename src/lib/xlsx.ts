import type { CsvTable } from "./csv";

const ISO_DATE_LENGTH = 10;

/** Ячейка Excel строкой, как в CSV: дата — «ГГГГ-ММ-ДД», пустая ячейка — пустая строка. */
function cellText(cell: unknown): string {
  if (cell instanceof Date) return cell.toISOString().slice(0, ISO_DATE_LENGTH);
  return cell === null || cell === undefined ? "" : String(cell).trim();
}

/**
 * Первый лист файла Excel (.xlsx) в том же виде, что и разобранный CSV: заголовки в первой строке.
 * Библиотека подгружается только при выборе такого файла. null — файл пустой или не читается.
 */
export async function parseXlsx(file: File): Promise<CsvTable | null> {
  try {
    const { readSheet } = await import("read-excel-file/browser");
    const rows = (await readSheet(file)).map((row) => row.map(cellText)).filter((row) => row.some(Boolean));
    if (rows.length < 2 || rows[0].length < 2) return null;
    return { headers: rows[0], rows: rows.slice(1) };
  } catch {
    return null;
  }
}
