import type { Locale } from "./locale";
import type { Messages } from "./messages";

const dictionaries = {
  en: () => import("./messages/en.json").then((module) => module.default),
  zh: () => import("./messages/zh.json").then((module) => module.default),
};

export async function getDictionary(locale: Locale): Promise<Messages> {
  return dictionaries[locale]();
}
