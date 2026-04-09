import { ControlPlaneShell } from "@/components/control-plane-shell";
import Link from "next/link";

export default function SettingsPage() {
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
          <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
          <p className="text-sm text-muted-foreground">
            Runtime connection details for the current control-plane environment.
          </p>
        </div>
        <dl className="space-y-3 text-sm text-muted-foreground">
          <div className="flex items-center justify-between gap-4">
            <dt>Runtime mode</dt>
            <dd>{settings.runtimeMode}</dd>
          </div>
          <div className="flex items-center justify-between gap-4">
            <dt>Gateway URL</dt>
            <dd className="max-w-[32rem] break-all text-right">{settings.gatewayUrl}</dd>
          </div>
          <div className="flex items-center justify-between gap-4">
            <dt>Work poll interval</dt>
            <dd>{settings.pollIntervalMs}ms</dd>
          </div>
        </dl>
        <div className="rounded-xl border bg-muted/30 p-4">
          <div className="space-y-1">
            <h2 className="text-sm font-medium text-foreground">Advanced</h2>
            <p className="text-sm text-muted-foreground">
              Workspace management and deeper operational controls live outside the daily task flow.
            </p>
          </div>
          <div className="mt-3">
            <Link
              href="/settings/advanced"
              className="inline-flex rounded-md border px-3 py-2 text-sm text-foreground transition-colors hover:bg-muted"
            >
              Open Advanced Settings
            </Link>
          </div>
        </div>
      </div>
    </ControlPlaneShell>
  );
}
