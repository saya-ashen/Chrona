import { defaultLocale, locales, type Locale, resolveLocale } from "@/i18n/config";

function isExternalHref(href: string) {
  return /^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(href);
}

export function hasLocalePrefix(pathname: string) {
  return locales.some((locale) => pathname === `/${locale}` || pathname.startsWith(`/${locale}/`));
}

export function stripLocalePrefix(pathname: string) {
  for (const locale of locales) {
    if (pathname === `/${locale}`) {
      return "/";
    }

    if (pathname.startsWith(`/${locale}/`)) {
      return pathname.slice(locale.length + 1) || "/";
    }
  }

  return pathname || "/";
}

export function localizeHref(locale: Locale | undefined, href: string) {
  if (!href || isExternalHref(href) || href.startsWith("#") || href.startsWith("?")) {
    return href;
  }

  const activeLocale = resolveLocale(locale ?? defaultLocale);

  if (hasLocalePrefix(href)) {
    return href;
  }

  const [withoutHash, hash = ""] = href.split("#");
  const [pathname = "/", search = ""] = withoutHash.split("?");
  const normalizedPath = pathname === "/" ? "" : pathname;
  const localizedPath = normalizedPath ? `/${activeLocale}${normalizedPath}` : `/${activeLocale}`;

  return `${localizedPath}${search ? `?${search}` : ""}${hash ? `#${hash}` : ""}`;
}

export function switchLocaleHref(pathname: string, locale: Locale, search?: string) {
  const strippedPath = stripLocalePrefix(pathname);
  const base = localizeHref(locale, strippedPath);

  return search ? `${base}?${search}` : base;
}

export function getPathVariants(path: string) {
  return [path, ...locales.map((locale) => localizeHref(locale, path))];
}
