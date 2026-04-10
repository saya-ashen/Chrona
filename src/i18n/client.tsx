"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { defaultLocale, type Locale } from "@/i18n/config";
import type { Messages } from "@/i18n/get-dictionary";
import defaultMessages from "@/i18n/messages/en.json";

type I18nContextValue = {
  locale: Locale;
  messages: Messages;
  t: (key: string) => string;
};

const I18nContext = createContext<I18nContextValue>({
  locale: defaultLocale,
  messages: defaultMessages,
  t: (key) => getMessage(defaultMessages, key),
});

function getMessage(messages: Messages, key: string) {
  const value = key.split(".").reduce<unknown>((current, segment) => {
    if (current && typeof current === "object" && segment in current) {
      return (current as Record<string, unknown>)[segment];
    }

    return undefined;
  }, messages);

  return typeof value === "string" ? value : key;
}

export function I18nProvider({
  children,
  locale,
  messages,
}: {
  children: ReactNode;
  locale: Locale;
  messages: Messages;
}) {
  const value = useMemo<I18nContextValue>(
    () => ({
      locale,
      messages,
      t: (key) => getMessage(messages, key),
    }),
    [locale, messages],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  return useContext(I18nContext);
}

export function useLocale() {
  return useI18n().locale;
}
