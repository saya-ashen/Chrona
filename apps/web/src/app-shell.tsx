import { Outlet, useLoaderData } from "react-router-dom";

import { AssistantSurfaceProvider } from "@/components/assistant-surface/assistant-surface-provider";
import { ControlPlaneShell } from "@/components/control-plane-shell";
import { I18nProvider } from "@chrona/i18n/react";

import type { AppBootData } from "./pages";

export function AppShell() {
  const data = useLoaderData() as AppBootData;
  const { locale, dictionary } = data;

  return (
    <I18nProvider locale={locale} messages={dictionary}>
      <AssistantSurfaceProvider>
        <ControlPlaneShell defaultWorkspace={data.defaultWorkspace}>
          <Outlet context={data} />
        </ControlPlaneShell>
      </AssistantSurfaceProvider>
    </I18nProvider>
  );
}
