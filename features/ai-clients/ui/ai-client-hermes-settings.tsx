import { Controller, type UseFormReturn } from "react-hook-form";
import { Badge, Button, Card, CardContent, Field, FieldLabel, Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@shared/ui";
import type { ClientFormValues, HermesClientScope, HermesIntegrationResult } from "./ai-client-types";
import { diagnoseHermes, LOCAL_HERMES_BASE_URL, restartLocalHermes, setupLocalHermes } from "./ai-client-view-model";

export function HermesSettings({ form, copy, isLocalHermes, busy, result, setBusy, setResult }: {
  form: UseFormReturn<ClientFormValues>;
  copy: Record<string, string>;
  isLocalHermes: boolean;
  busy: "diagnose" | "setup" | "restart" | null;
  result: HermesIntegrationResult | null;
  setBusy: (value: "diagnose" | "setup" | "restart" | null) => void;
  setResult: (result: HermesIntegrationResult | null | ((current: HermesIntegrationResult | null) => HermesIntegrationResult)) => void;
}) {
  const runAction = async (action: "diagnose" | "setup" | "restart") => {
    setBusy(action);
    try {
      if (action === "diagnose") setResult(await diagnoseHermes(form.getValues()));
      if (action === "setup") {
        const next = await setupLocalHermes(form.getValues());
        setResult(next);
        if (next.apiKey) form.setValue("apiKey", next.apiKey, { shouldDirty: true });
      }
      if (action === "restart") {
        const restart = await restartLocalHermes();
        setResult((current) => ({
          diagnostics: current?.diagnostics ?? { mode: "local", restartRequired: false, checks: [] },
          plan: current?.plan ?? { summary: copy.restartHermesRequested, canRunAutomatically: false, actions: [] },
          changed: current?.changed, maskedApiKey: current?.maskedApiKey, restart,
        }));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : copy.reasonUnknown;
      setResult((current) => ({
        diagnostics: current?.diagnostics ?? { mode: "unknown", restartRequired: false, checks: [] },
        plan: current?.plan ?? { summary: message, canRunAutomatically: false, actions: [] },
        changed: current?.changed, maskedApiKey: current?.maskedApiKey,
        restart: action === "restart" ? { ok: false, exitCode: null, message } : current?.restart,
      }));
    } finally {
      setBusy(null);
    }
  };
  return <Card className="border-dashed bg-muted/25" size="sm"><CardContent className="flex flex-col gap-4">
    <Field><FieldLabel>{copy.hermesScopeLabel}</FieldLabel><Controller name="hermesScope" control={form.control} render={({ field, fieldState }) => <Select value={field.value} onValueChange={(scope: HermesClientScope) => {
      field.onChange(scope);
      const baseUrl = form.getValues("baseUrl");
      if (scope === "remote" && baseUrl === LOCAL_HERMES_BASE_URL) form.setValue("baseUrl", "", { shouldDirty: true, shouldValidate: true });
      if (scope === "local" && !baseUrl) form.setValue("baseUrl", LOCAL_HERMES_BASE_URL, { shouldDirty: true, shouldValidate: true });
    }}><SelectTrigger className="w-full" aria-invalid={fieldState.invalid} aria-label={copy.hermesScopeLabel}><SelectValue /></SelectTrigger><SelectContent><SelectGroup><SelectItem value="local">{copy.hermesScopeLocal}</SelectItem><SelectItem value="remote">{copy.hermesScopeRemote}</SelectItem></SelectGroup></SelectContent></Select>} /></Field>
    <p className="text-sm text-muted-foreground">{isLocalHermes ? copy.hermesLocalDescription : copy.hermesRemoteDescription}</p>
    <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" disabled={busy !== null} onClick={() => void runAction("diagnose")}>{busy === "diagnose" ? copy.testing : copy.diagnoseHermes}</Button>
      {isLocalHermes ? <Button type="button" variant="secondary" disabled={busy !== null} onClick={() => void runAction("setup")}>{busy === "setup" ? copy.testing : copy.autoConfigureHermes}</Button> : null}
      {isLocalHermes ? <Button type="button" variant="outline" disabled={busy !== null} onClick={() => void runAction("restart")}>{busy === "restart" ? copy.testing : copy.restartHermes}</Button> : null}
    </div>
    {isLocalHermes ? <p className="text-xs text-muted-foreground">{copy.hermesRestartDescription}</p> : null}
    {result ? <HermesResult copy={copy} result={result} /> : null}
  </CardContent></Card>;
}

function HermesResult({ copy, result }: { copy: Record<string, string>; result: HermesIntegrationResult }) {
  return <div className="grid gap-3 text-sm md:grid-cols-2"><div className="rounded-md border bg-background p-3"><div className="mb-2 font-medium">{copy.hermesDiagnosticsTitle}</div><div className="flex flex-col gap-1">{result.diagnostics.checks.slice(0, 6).map((check) => <div key={check.key} className="flex gap-2"><Badge variant={check.status === "error" ? "destructive" : check.status === "ok" ? "default" : "secondary"}>{check.status}</Badge><span className="text-muted-foreground">{check.message}</span></div>)}</div></div><div className="rounded-md border bg-background p-3"><div className="mb-2 font-medium">{copy.hermesPlanTitle}</div><p className="text-muted-foreground">{result.plan.summary}</p>{result.maskedApiKey ? <p className="mt-2 text-muted-foreground">API key: {result.maskedApiKey}</p> : null}{result.changed?.length ? <p className="mt-2 text-muted-foreground">{copy.hermesChangedTitle}: {result.changed.join(", ")}</p> : null}{result.diagnostics.restartRequired ? <p className="mt-2 text-muted-foreground">{copy.hermesRestartRequired}</p> : null}{result.restart ? <p className="mt-2 text-muted-foreground">{result.restart.message}</p> : null}</div></div>;
}
