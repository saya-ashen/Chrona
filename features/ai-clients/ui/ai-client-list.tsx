import { Badge, Button, Card, CardDescription, CardHeader, CardTitle, Checkbox, Field, FieldLabel } from "@shared/ui";
import type { AiClientDiagnosticsResponse } from "../browser-api";
import { ReadinessChecklist, readinessItems } from "./ai-client-readiness";
import type { AiClientInfo, TestResult } from "./ai-client-types";
import { getFeatureCopy, getStatusLabel, getStatusVariant, normalizeDebugProfile } from "./ai-client-view-model";

type RuntimeDiagnostics = NonNullable<AiClientDiagnosticsResponse["diagnostics"]>;

export function AiClientList({ clients, copy, cardTestStates, diagnostics, diagnosticsLoading, editingId, onEdit, onDelete, onMakeDefault, onToggleEnabled, onTest, onInspect, renderEditor }: {
  clients: AiClientInfo[];
  copy: Record<string, string>;
  cardTestStates: Record<string, TestResult>;
  diagnostics: Record<string, RuntimeDiagnostics>;
  diagnosticsLoading: Record<string, boolean>;
  editingId: string | null;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  onMakeDefault: (id: string) => void;
  onToggleEnabled: (id: string, enabled: boolean) => void;
  onTest: (client: AiClientInfo) => void;
  onInspect: (id: string) => void;
  renderEditor: (client: AiClientInfo) => React.ReactNode;
}) {
  return <>{clients.map((client) => editingId === client.id ? <Card key={client.id} size="sm">{renderEditor(client)}</Card> : <ClientCard key={client.id} client={client} clients={clients} copy={copy} testResult={cardTestStates[client.id] ?? { status: "idle", reason: null }} diagnostics={diagnostics[client.id]} loadingDiagnostics={diagnosticsLoading[client.id] === true} onEdit={onEdit} onDelete={onDelete} onMakeDefault={onMakeDefault} onToggleEnabled={onToggleEnabled} onTest={onTest} onInspect={onInspect} />)}</>;
}

export function isFeatureAssignedToClient(client: Pick<AiClientInfo, "id" | "isDefault" | "bindings">, clients: Array<Pick<AiClientInfo, "id" | "bindings">>, feature: string): boolean {
  if (client.bindings.includes(feature)) return true;
  return client.isDefault && !clients.some((candidate) => candidate.id !== client.id && candidate.bindings.includes(feature));
}

function ClientCard({ client, clients, copy, testResult, diagnostics, loadingDiagnostics, onEdit, onDelete, onMakeDefault, onToggleEnabled, onTest, onInspect }: {
  client: AiClientInfo;
  copy: Record<string, string>;
  clients: AiClientInfo[];
  testResult: TestResult;
  diagnostics: RuntimeDiagnostics | undefined;
  loadingDiagnostics: boolean;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  onMakeDefault: (id: string) => void;
  onToggleEnabled: (id: string, enabled: boolean) => void;
  onTest: (client: AiClientInfo) => void;
  onInspect: (id: string) => void;
}) {
  const readiness = readinessItems({
    copy,
    type: client.type,
    configured: true,
    enabled: client.enabled,
    testStatus: testResult.status,
    testReason: testResult.reason,
    bindings: client.bindings,
    isDefault: client.isDefault,
    assignedToPlanning: isFeatureAssignedToClient(client, clients, "task.plan"),
    assignedToExecution: isFeatureAssignedToClient(client, clients, "task.execution"),
  });
  return <Card size="sm"><CardHeader className="gap-3 sm:grid-cols-[1fr_auto]"><div className="flex min-w-0 flex-col gap-2"><div className="flex flex-wrap items-center gap-2"><CardTitle>{client.name}</CardTitle><Badge variant="secondary">{client.type}</Badge>{client.isDefault ? <Badge variant="default">{copy.defaultBadge}</Badge> : null}</div><CardDescription><ClientDescription client={client} /><ClientBindings bindings={client.bindings} /></CardDescription><div className="flex flex-wrap items-center gap-2 text-xs"><Button type="button" variant="outline" size="xs" onClick={() => onTest(client)}>{copy.testAvailability}</Button><Badge variant={getStatusVariant(testResult.status)}>{getStatusLabel(copy, testResult.status)}</Badge><span className="text-muted-foreground">{testResult.reason ?? copy.reasonUnknown}</span></div><ReadinessChecklist items={readiness} />{diagnostics ? <DiagnosticsView diagnostics={diagnostics} copy={copy} clientId={client.id} /> : null}</div><ClientActions client={client} copy={copy} loadingDiagnostics={loadingDiagnostics} onEdit={onEdit} onDelete={onDelete} onMakeDefault={onMakeDefault} onToggleEnabled={onToggleEnabled} onInspect={onInspect} /></CardHeader></Card>;
}

function ClientDescription({ client }: { client: AiClientInfo }) {
  if (client.type === "debug") return <span>Local debug provider: {normalizeDebugProfile((client.config as { profile?: unknown }).profile)}</span>;
  if (client.type === "hermes") return <span>Hermes: {(client.config as { baseUrl?: string }).baseUrl ?? "http://127.0.0.1:8642"}</span>;
  const config = client.config as { baseUrl?: string; model?: string };
  return <span>{config.baseUrl ?? "—"} · {config.model ?? "default"}</span>;
}

function ClientBindings({ bindings }: { bindings: string[] }) {
  const features = bindings.filter((feature) => feature !== "suggest");
  return features.length ? <div className="flex flex-wrap gap-1">{features.map((feature) => <Badge key={feature} variant="outline">{getFeatureCopy(feature).label}</Badge>)}</div> : null;
}

function ClientActions({ client, copy, loadingDiagnostics, onEdit, onDelete, onMakeDefault, onToggleEnabled, onInspect }: {
  client: AiClientInfo;
  copy: Record<string, string>;
  loadingDiagnostics: boolean;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  onMakeDefault: (id: string) => void;
  onToggleEnabled: (id: string, enabled: boolean) => void;
  onInspect: (id: string) => void;
}) {
  return <div className="flex flex-wrap items-center gap-2 sm:justify-end"><Field orientation="horizontal" className="w-auto gap-2"><Checkbox aria-label={`${client.name}: ${copy.enabled}`} checked={client.enabled} onCheckedChange={(checked) => onToggleEnabled(client.id, checked === true)} /><FieldLabel className="text-xs text-muted-foreground">{copy.enabled}</FieldLabel></Field>{!client.isDefault && client.enabled ? <Button type="button" variant="outline" size="xs" onClick={() => onMakeDefault(client.id)}>{copy.makeDefault}</Button> : null}<Button type="button" variant="outline" size="xs" onClick={() => onInspect(client.id)} disabled={loadingDiagnostics}>{loadingDiagnostics ? copy.inspectingRuntime : copy.viewRuntimeConfiguration}</Button><Button type="button" variant="outline" size="xs" onClick={() => onEdit(client.id)}>{copy.edit}</Button><Button type="button" variant="destructive" size="xs" onClick={() => onDelete(client.id)}>{copy.delete}</Button></div>;
}

function DiagnosticsView({ diagnostics, copy, clientId }: { diagnostics: RuntimeDiagnostics; copy: Record<string, string>; clientId: string }) {
  const value = (item: string | number | null, source: "provider_default" | "provider_override" | "task_override" | "runtime") => source === "provider_default" ? `${item ?? copy.unresolved} (${copy.defaultSource})` : String(item ?? copy.unresolved);
  return <div className="grid gap-1 rounded-md border bg-muted/30 p-3 text-xs sm:grid-cols-2" data-testid={`provider-diagnostics-${clientId}`}><span>{copy.modelLabel}: {value(diagnostics.model ?? null, diagnostics.sources.model)}</span><span>{copy.contextStrategy}: {value(diagnostics.contextStrategy, diagnostics.sources.context)}</span><span>{copy.configDirectory}: {value(diagnostics.configDirectory ?? null, diagnostics.sources.configDirectory)}</span><span>{copy.agentDirectory}: {value(diagnostics.agentDirectory ?? null, diagnostics.sources.agentDirectory)}</span><span>MCP: {diagnostics.configurationCapabilities.tooling.mcp.enabled ? copy.enabled : copy.unavailable}</span><span>LSP: {diagnostics.configurationCapabilities.tooling.lsp.enabled ? copy.enabled : copy.unavailable}</span><span>{copy.subagents}: {diagnostics.configurationCapabilities.tooling.subagents.enabled ? copy.enabled : copy.unavailable}</span><span>{copy.enabledTools}: {diagnostics.configurationCapabilities.tooling.enabledTools.join(", ") || copy.chronaRunToolsOnly}</span></div>;
}
