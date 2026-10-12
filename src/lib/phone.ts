import { AsYouType, parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js";
import { APP } from "./config";

const DEFAULT_COUNTRY = APP.defaultCountry as CountryCode;

/** «8 701 123-45-67» → «+77011234567». null, если номер невалидный. */
export function normalizePhone(input: string, country: CountryCode = DEFAULT_COUNTRY): string | null {
  const parsed = parsePhoneNumberFromString(input.trim(), country);
  return parsed?.isValid() ? parsed.number : null;
}

/** «+77011234567» → «+7 701 123 4567» */
export function formatPhone(e164: string): string {
  return parsePhoneNumberFromString(e164)?.formatInternational() ?? e164;
}

/** Автоформат при вводе. */
export function formatPhoneInput(input: string, country: CountryCode = DEFAULT_COUNTRY): string {
  return new AsYouType(country).input(input);
}
