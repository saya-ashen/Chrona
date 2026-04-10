import "server-only";
import enMessages from "@/i18n/messages/en.json";
import type { Locale } from "@/i18n/config";

const dictionaries = {
  en: () => import("@/i18n/messages/en.json").then((module) => module.default),
  zh: () => import("@/i18n/messages/zh.json").then((module) => module.default),
};

export type Messages = typeof enMessages;

export async function getDictionary(locale: Locale): Promise<Messages> {
  return dictionaries[locale]();
}
