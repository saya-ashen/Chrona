import { ControlPlaneShell } from "@/components/control-plane-shell";
import { LocalizedLink } from "@/components/i18n/localized-link";
import { resolveLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/get-dictionary";

export default async function SettingsPage(props: { params?: Promise<{ lang?: string }> }) {
  const locale = resolveLocale((await props.params)?.lang);
  const t = (await getDictionary(locale)).pages.settings;
  const settings = {
    runtimeMode: process.env.OPENCLAW_MODE ?? "live",
    gatewayUrl:
      process.env.OPENCLAW_GATEWAY_URL ??
      process.env.OPENCLAW_BASE_URL ??
      "ws://localhost:3001/gateway",
    pollIntervalMs: process.env.NEXT_PUBLIC_WORK_POLL_INTERVAL_MS ?? "10000",
  };

  return (
    <ControlPlaneShell>
      <div className="space-y-4 rounded-2xl border bg-card p-6 shadow-sm">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">{t.title}</h1>
          <p className="text-sm text-muted-foreground">{t.subtitle}</p>
        </div>
        <dl className="space-y-3 text-sm text-muted-foreground">
          <div className="flex items-center justify-between gap-4">
            <dt>{t.runtimeMode}</dt>
            <dd>{settings.runtimeMode}</dd>
          </div>
          <div className="flex items-center justify-between gap-4">
            <dt>{t.gatewayUrl}</dt>
            <dd className="max-w-[32rem] break-all text-right">{settings.gatewayUrl}</dd>
          </div>
          <div className="flex items-center justify-between gap-4">
            <dt>{t.workPollInterval}</dt>
            <dd>{settings.pollIntervalMs}ms</dd>
          </div>
        </dl>
        <div className="rounded-xl border bg-muted/30 p-4">
          <div className="space-y-1">
            <h2 className="text-sm font-medium text-foreground">AI Clients</h2>
            <p className="text-sm text-muted-foreground">管理 AI 客户端，配置各智能功能使用的 Client</p>
          </div>
          <div className="mt-3">
            <LocalizedLink
              href="/settings/ai-clients"
              className="inline-flex rounded-md border px-3 py-2 text-sm text-foreground transition-colors hover:bg-muted"
            >
              管理 AI Clients
            </LocalizedLink>
          </div>
        </div>
        <div className="rounded-xl border bg-muted/30 p-4">
          <div className="space-y-1">
            <h2 className="text-sm font-medium text-foreground">{t.advancedTitle}</h2>
            <p className="text-sm text-muted-foreground">{t.advancedDescription}</p>
          </div>
          <div className="mt-3">
            <LocalizedLink
              href="/settings/advanced"
              className="inline-flex rounded-md border px-3 py-2 text-sm text-foreground transition-colors hover:bg-muted"
            >
              {t.openAdvancedSettings}
            </LocalizedLink>
          </div>
        </div>
      </div>
    </ControlPlaneShell>
  );
}
