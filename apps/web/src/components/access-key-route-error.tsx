import { useRouteError } from "react-router-dom";
import { defaultLocale } from "@chrona/i18n";
import { I18nProvider } from "@chrona/i18n/react";
import { fallbackMessages } from "@chrona/i18n/messages";

import { AccessKeyUnlock } from "@/components/access-key-unlock";
import { setAccessKey } from "@/lib/access-key";

function getErrorStatus(error: unknown) {
  if (error instanceof Response) return error.status;
  if (error && typeof error === "object" && "status" in error) {
    const status = (error as { status?: unknown }).status;
    return typeof status === "number" ? status : null;
  }
  return null;
}

export function AccessKeyRouteError() {
  const error = useRouteError();

  if (getErrorStatus(error) === 401) {
    return (
      <I18nProvider locale={defaultLocale} messages={fallbackMessages}>
        <AccessKeyUnlock
          onUnlock={(key, remember) => {
            setAccessKey(key, remember);
            window.location.reload();
          }}
        />
      </I18nProvider>
    );
  }

  throw error;
}
