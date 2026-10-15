import { resolveLocale } from "@chrona/i18n";
import { I18nProvider } from "@chrona/i18n/react";
import type { ReactNode } from "react";
import en from "../../../../packages/i18n/src/messages/en.json";
import zh from "../../../../packages/i18n/src/messages/zh.json";
import { Button } from "@shared/ui";

// Error fallbacks can render outside the route's (failed) provider.
export function ErrorLocaleProvider({ children }: { children: ReactNode }) {
  const locale = resolveLocale(window.location.pathname.split("/")[1]);
  return <I18nProvider locale={locale} messages={locale === "zh" ? zh : en}>{children}</I18nProvider>;
}

export function ErrorScreen() {
  const locale = resolveLocale(window.location.pathname.split("/")[1]);
  const copy = (locale === "zh" ? zh : en).steward.errors;
  return <section role="alert" className="mx-auto flex min-h-[60vh] max-w-5xl flex-col items-center justify-center gap-4 px-4 text-center">
    <h1 className="text-2xl font-semibold">{copy.title}</h1>
    <p className="max-w-prose text-muted-foreground">{copy.description}</p>
    <Button onClick={() => window.location.reload()}>{copy.refresh}</Button>
  </section>;
}
