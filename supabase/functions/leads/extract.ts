// Разбор заявки с сайта: телефон, имя и метки из тела запроса в любом распространённом виде
// (JSON, форма Tilda, вебхук квиза с вложенными полями). Без обращений к сети и базе.
import { type CountryCode, parsePhoneNumberFromString } from "npm:libphonenumber-js@1.13.15/min";

/** Метки, по которым лид связывается с объявлением. */
export const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "fbclid", "ttclid"] as const;
export type Utm = Partial<Record<(typeof UTM_KEYS)[number], string>>;

const PHONE_KEYS = ["phone", "tel", "telephone", "phone_number", "phonenumber", "mobile", "whatsapp", "телефон", "номер"];
/** Названия, которые ищем и внутри имени поля: «your-phone», «phone_2», «Телефон для связи». */
const PHONE_KEY_PARTS = ["phone", "телефон"];
const NAME_KEYS = ["name", "fullname", "full_name", "first_name", "firstname", "fio", "имя", "фио"];
/** Номер заявки на стороне сайта: по нему отсекаются повторные отправки. tranid присылает Tilda. */
const EXTERNAL_ID_KEYS = ["external_id", "tranid", "lead_id"];
const MAX_DEPTH = 5;
const MAX_FIELDS = 300;
const MAX_NAME_LENGTH = 120;
const MAX_VALUE_LENGTH = 500;
const MIN_PHONE_DIGITS = 7;
/** Макрос платформы, который не подставился: «{{ad.id}}» или «__CID__». Такое значение бесполезно. */
const RAW_MACRO_RE = /\{\{.*\}\}|^__[A-Z_]+__$/;

export interface ExtractedLead {
  /** Телефон в E.164 или null, если номер не найден либо невалиден. */
  phone: string | null;
  name: string;
  utm: Utm;
  externalId: string | null;
}

/** Плоский вид заявки: «путь.к.полю» в нижнем регистре → значение строкой. */
export function flatten(value: unknown, prefix = "", out = new Map<string, string>(), depth = 0): Map<string, string> {
  if (out.size >= MAX_FIELDS || depth > MAX_DEPTH || value === null || value === undefined) return out;
  if (typeof value === "object") {
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      flatten(nested, prefix ? `${prefix}.${key.toLowerCase()}` : key.toLowerCase(), out, depth + 1);
    }
  } else if (prefix) {
    out.set(prefix, String(value).trim().slice(0, MAX_VALUE_LENGTH));
  }
  return out;
}

const lastSegment = (path: string) => path.slice(path.lastIndexOf(".") + 1);

/** Значение поля по точному названию, а если такого нет — по вхождению одной из частей в название. */
function pick(fields: Map<string, string>, keys: string[], parts: string[] = []): string {
  for (const key of keys) {
    for (const [path, value] of fields) if (value && lastSegment(path) === key) return value;
  }
  for (const part of parts) {
    for (const [path, value] of fields) if (value && lastSegment(path).includes(part)) return value;
  }
  return "";
}

/** «8 701 123-45-67» → «+77011234567». null, если номер невалидный. */
export function normalizePhone(input: string, country: string): string | null {
  if (input.replace(/\D/g, "").length < MIN_PHONE_DIGITS) return null;
  const parsed = parsePhoneNumberFromString(input.trim(), country as CountryCode);
  return parsed?.isValid() ? parsed.number : null;
}

/** Метка может прийти как «utm_content» или вложенно: «utm.content» (так присылают квизы). */
function utmOf(fields: Map<string, string>): Utm {
  const utm: Utm = {};
  for (const key of UTM_KEYS) {
    const nested = `utm.${key.replace("utm_", "")}`;
    for (const [path, value] of fields) {
      if (!value || RAW_MACRO_RE.test(value)) continue;
      if (lastSegment(path) === key || path === nested || path.endsWith(`.${nested}`)) {
        utm[key] = value;
        break;
      }
    }
  }
  return utm;
}

export function extractLead(body: unknown, country: string): ExtractedLead {
  const fields = flatten(body);
  return {
    phone: normalizePhone(pick(fields, PHONE_KEYS, PHONE_KEY_PARTS), country),
    name: pick(fields, NAME_KEYS).slice(0, MAX_NAME_LENGTH),
    utm: utmOf(fields),
    externalId: pick(fields, EXTERNAL_ID_KEYS) || null,
  };
}

/** Проверочный запрос, которым конструктор сайтов проверяет адрес вебхука (Tilda шлёт test=test). */
export function isProbe(body: unknown): boolean {
  const fields = flatten(body);
  return fields.get("test") === "test" && !pick(fields, PHONE_KEYS, PHONE_KEY_PARTS);
}

/** Тело запроса объектом: JSON (в том числе присланный как text/plain) или поля формы. */
export function parseBody(text: string, contentType: string): Record<string, unknown> {
  const type = contentType.toLowerCase();
  if (type.includes("application/x-www-form-urlencoded")) return Object.fromEntries(new URLSearchParams(text));
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    // Не JSON: пробуем как поля формы, это безопасно и для пустого тела
    return Object.fromEntries(new URLSearchParams(text));
  }
}
