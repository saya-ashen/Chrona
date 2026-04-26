import { Outlet, useLoaderData } from "react-router-dom";

import { ControlPlaneShell } from "@/components/control-plane-shell";
import { I18nProvider } from "@/i18n/client";

import type { AppBootData } from "./pages";

export function AppShell() {
  const { locale, dictionary } = useLoaderData() as AppBootData;

  return (
    <I18nProvider locale={locale} messages={dictionary}>
      <ControlPlaneShell>
        <Outlet />
      </ControlPlaneShell>
    </I18nProvider>
  );
}
