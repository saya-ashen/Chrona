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
    if (language === "zh" || language.startsWith("zh-")) {
      return "zh";
    }

    if (language === "en" || language.startsWith("en-")) {
      return "en";
    }
  }

  return defaultLocale;
}
