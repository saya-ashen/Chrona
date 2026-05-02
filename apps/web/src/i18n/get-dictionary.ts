import type { Locale } from "@/i18n/config";
import type { Messages } from "@/i18n/messages";

const dictionaries = {
  en: () => import("@/i18n/messages/en.json").then((module) => module.default),
  zh: () => import("@/i18n/messages/zh.json").then((module) => module.default),
};



export async function getDictionary(locale: Locale): Promise<Messages> {
  return dictionaries[locale]();
}
