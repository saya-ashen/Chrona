import { TodayPage } from "@features/steward";
import type { getDictionary, Locale } from "@chrona/i18n";

export type Dictionary = Awaited<ReturnType<typeof getDictionary>>;
export type AppBootData = {
  locale: Locale;
  dictionary: Dictionary;
  defaultWorkspace: { id: string; name: string };
};

export function TodayRoutePage() {
  return <TodayPage />;
}
