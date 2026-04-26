import { Outlet, useLoaderData } from "react-router-dom";

import { ControlPlaneShell } from "@/components/control-plane-shell";
import { I18nProvider } from "@/i18n/client";

import type { AppBootData } from "./pages";

export function AppShell() {
  const data = useLoaderData() as AppBootData;
  const { locale, dictionary } = data;

  return (
    <I18nProvider locale={locale} messages={dictionary}>
      <ControlPlaneShell>
        <Outlet context={data} />
      </ControlPlaneShell>
    </I18nProvider>
  );
}
