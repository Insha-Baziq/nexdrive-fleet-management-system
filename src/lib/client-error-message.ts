import { translateText, type AppLocale } from "@/lib/locale";

export function localizeClientError(
  value: unknown,
  locale: AppLocale,
  fallback: Record<AppLocale, string>,
): string {
  const source = typeof value === "string" && value.trim() ? value.trim() : fallback[locale];
  const translated = translateText(source, locale);
  if (locale === "fr" && translated === source && /^[\x00-\x7F]+$/.test(source)) return fallback.fr;
  return translated;
}
