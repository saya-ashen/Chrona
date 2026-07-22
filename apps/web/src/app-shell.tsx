import type { ReactNode } from "react";
import { Outlet, useLoaderData } from "react-router-dom";

import { AssistantSurfaceProvider, useAssistantSurface } from "@features/assistant-surface";
import { AccessKeyGate } from "@/components/access-key-gate";
import { ControlPlaneShell } from "@features/mcp-control-plane";
import { I18nProvider } from "@chrona/i18n/react";

import type { AppBootData } from "./pages";

export function AppShell() {
  const data = useLoaderData() as AppBootData;
  const { locale, dictionary } = data;

  return (
    <I18nProvider locale={locale} messages={dictionary}>
      <AccessKeyGate>
        <AssistantSurfaceProvider>
          <ControlPlaneShellWithAssistantSummary defaultWorkspace={data.defaultWorkspace}>
            <Outlet context={data} />
          </ControlPlaneShellWithAssistantSummary>
        </AssistantSurfaceProvider>
      </AccessKeyGate>
    </I18nProvider>
  );
}

function ControlPlaneShellWithAssistantSummary({
  children,
  defaultWorkspace,
}: {
  children: ReactNode;
  defaultWorkspace: AppBootData["defaultWorkspace"];
}) {
  const assistant = useAssistantSurface();

  return (
    <ControlPlaneShell
      defaultWorkspace={defaultWorkspace}
      assistantSummary={assistant.state.status === "unavailable" || assistant.state.status === "empty" ? undefined : assistant.state.topSummary}
    >
      {children}
    </ControlPlaneShell>
  );
}
