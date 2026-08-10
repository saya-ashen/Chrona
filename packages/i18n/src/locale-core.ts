export const locales = ["en", "zh"] as const;

export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = "en";

export function hasLocale(locale: string): locale is Locale {
  return locales.includes(locale as Locale);
}

export function resolveLocale(locale?: string | null): Locale {
  return locale && hasLocale(locale) ? locale : defaultLocale;
}

export function getPreferredLocale(acceptLanguage: string | null | undefined): Locale {
  if (!acceptLanguage) {
    return defaultLocale;
  }

  const languages = acceptLanguage
    .split(",")
    .map((part) => part.trim().split(";")[0]?.toLowerCase())
    .filter((part): part is string => Boolean(part));

  for (const language of languages) {
    const baseLanguage = language.split("-")[0];
    if (baseLanguage && hasLocale(baseLanguage)) {
      return baseLanguage;
    }
  }

  return defaultLocale;
}
