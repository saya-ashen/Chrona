import { useEffect, useMemo, useRef, useState } from "react";
import { Controller, useForm, type UseFormReturn } from "react-hook-form";
import { Badge, Button, Card, CardContent, Checkbox, Field, FieldContent, FieldError, FieldGroup, FieldLabel, Input, Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@shared/ui";
import { AdvancedSettings } from "./ai-client-advanced-settings";
import { HermesSettings } from "./ai-client-hermes-settings";
import { ReadinessChecklist, hasBasicConfig, readinessItems } from "./ai-client-readiness";
import type { AiClientInfo, ClientFormValues, ClientSaveData, HermesIntegrationResult, RuntimeProviderOption, TestStatus } from "./ai-client-types";
import { buildClientPayload, getDefaultClientName, getInitialFormValues, getProviderFeatures, getStatusLabel, getStatusVariant, LOCAL_HERMES_BASE_URL, recommendedFeatureBindings, sameBindings, testClientAvailability } from "./ai-client-view-model";

export function ClientForm({ initial, onSave, onCancel, copy, providers, forceDefault = false }: {
  initial?: AiClientInfo;
  onSave: (data: ClientSaveData) => void;
  onCancel: () => void;
  copy: Record<string, string>;
  providers: RuntimeProviderOption[];
  forceDefault?: boolean;
}) {
  const defaultValues = useMemo(() => getInitialFormValues(initial, providers, forceDefault), [initial, providers, forceDefault]);
  const form = useForm<ClientFormValues>({ defaultValues, mode: "onChange" });
  const values = form.watch();
  const features = getProviderFeatures(providers, values.type);
  const [testStatus, setTestStatus] = useState<TestStatus>("idle");
  const [testReason, setTestReason] = useState<string | null>(null);
  const [hermesResult, setHermesResult] = useState<HermesIntegrationResult | null>(null);
  const [hermesBusy, setHermesBusy] = useState<"diagnose" | "setup" | "restart" | null>(null);
  const lastAutoBindings = useRef(recommendedFeatureBindings(getProviderFeatures(providers, defaultValues.type)));
  const isHermes = values.type === "hermes";
  const isLocalHermes = isHermes && values.hermesScope === "local";

  useEffect(() => { form.reset(defaultValues); }, [defaultValues, form]);
  useEffect(() => {
    if (isLocalHermes && !values.baseUrl) form.setValue("baseUrl", LOCAL_HERMES_BASE_URL, { shouldDirty: true });
  }, [form, isLocalHermes, values.baseUrl]);
  useEffect(() => {
    if (initial) return;
    const recommended = recommendedFeatureBindings(features);
    const current = form.getValues("bindings");
    if (!current.length || sameBindings(current, lastAutoBindings.current)) {
      form.setValue("bindings", recommended, { shouldDirty: false });
      lastAutoBindings.current = recommended;
    }
  }, [features, form, initial]);

  const submit = (nextValues: ClientFormValues) => onSave({ payload: buildClientPayload({ ...nextValues, isDefault: forceDefault || nextValues.isDefault }), bindings: nextValues.bindings.filter((feature) => feature !== "suggest") });
  const testAvailability = async () => {
    setTestStatus("testing"); setTestReason(null);
    try { const result = await testClientAvailability(buildClientPayload(values)); setTestStatus(result.status); setTestReason(result.reason); }
    catch (error) { setTestStatus("unavailable"); setTestReason(error instanceof Error ? error.message : copy.reasonUnknown); }
  };
  const readiness = readinessItems({ copy, type: values.type, configured: hasBasicConfig(values.type, values), enabled: true, testStatus, testReason, bindings: values.bindings, isDefault: forceDefault || values.isDefault });

  return <Card size="sm"><CardContent><form className="flex flex-col gap-4" onSubmit={(event) => void form.handleSubmit(submit)(event)}><FieldGroup className="gap-4">
    <ClientIdentity form={form} copy={copy} providers={providers} placeholder={getDefaultClientName(values.type, providers)} />
    {isHermes ? <HermesSettings form={form} copy={copy} isLocalHermes={isLocalHermes} busy={hermesBusy} result={hermesResult} setBusy={setHermesBusy} setResult={setHermesResult} /> : null}
    <AdvancedSettings form={form} copy={copy} providers={providers} type={values.type} isLocalHermes={isLocalHermes} />
    <ReadinessChecklist items={readiness} />
    <DefaultClientField form={form} copy={copy} forceDefault={forceDefault} />
    <div className="flex flex-wrap items-center gap-2"><Button type="button" variant="outline" onClick={() => void testAvailability()}>{copy.testAvailability}</Button><Badge variant={getStatusVariant(testStatus)}>{getStatusLabel(copy, testStatus)}</Badge><span className="text-xs text-muted-foreground">{testReason ?? copy.reasonUnknown}</span></div>
    <div className="sticky bottom-0 z-10 -mx-1 flex flex-wrap gap-2 border-t bg-background/95 px-1 pt-4 pb-1 backdrop-blur supports-[backdrop-filter]:bg-background/80"><Button type="submit">{copy.save}</Button><Button type="button" variant="outline" onClick={onCancel}>{copy.cancel}</Button></div>
  </FieldGroup></form></CardContent></Card>;
}

function ClientIdentity({ form, copy, providers, placeholder }: { form: UseFormReturn<ClientFormValues>; copy: Record<string, string>; providers: RuntimeProviderOption[]; placeholder: string }) {
  const error = form.formState.errors.name;
  const selectedProvider = providers.find((provider) => provider.key === form.watch("type"));
  return <div className="grid gap-4 md:grid-cols-2"><Field data-invalid={Boolean(error)}><FieldLabel htmlFor="ai-client-name">{copy.nameLabel}</FieldLabel><Input {...form.register("name", { required: copy.nameLabel })} aria-invalid={Boolean(error)} id="ai-client-name" placeholder={placeholder} />{error ? <FieldError errors={[error]} /> : null}</Field><Field><FieldLabel>{copy.typeLabel}</FieldLabel><Controller name="type" control={form.control} render={({ field, fieldState }) => <Select value={field.value} onValueChange={field.onChange}><SelectTrigger className="w-full" aria-invalid={fieldState.invalid} aria-label={copy.typeLabel}><SelectValue /></SelectTrigger><SelectContent><SelectGroup>{providers.map((provider) => <SelectItem key={provider.key} value={provider.key}><span>{provider.label}</span><span className="ml-1 text-muted-foreground">· {provider.tier ?? "experimental"}{provider.recommended ? ` · ${copy.recommendedProvider ?? "Recommended"}` : ""}</span></SelectItem>)}</SelectGroup></SelectContent></Select>} />{selectedProvider ? <p className="mt-1 text-xs text-muted-foreground">Support tier: {selectedProvider.tier ?? "experimental"}{selectedProvider.recommended ? ` · ${copy.recommendedProvider ?? "Recommended"}` : ""}</p> : null}{selectedProvider?.key === "omp" ? <p className="mt-1 text-xs text-muted-foreground">{copy.ompRecoveryLimit ?? "Terminal-only read-only starts run once. If interrupted, Chrona does not replay them; start a new operation explicitly."}</p> : null}</Field></div>;
}

function DefaultClientField({ form, copy, forceDefault }: { form: UseFormReturn<ClientFormValues>; copy: Record<string, string>; forceDefault: boolean }) {
  return <Controller name="isDefault" control={form.control} render={({ field }) => <Field orientation="horizontal" className="items-start gap-3"><Checkbox aria-label={copy.setAsDefault} checked={forceDefault || field.value} disabled={forceDefault} onCheckedChange={(checked) => field.onChange(checked === true)} /><FieldContent><FieldLabel>{copy.setAsDefault}</FieldLabel><p className="text-xs text-muted-foreground">{copy.setAsDefaultHelp}</p></FieldContent></Field>} />;
}
