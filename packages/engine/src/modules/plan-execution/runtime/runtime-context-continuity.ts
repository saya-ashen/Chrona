import { db } from "@/lib/db";
import type { ProviderJsonValue } from "@chrona/providers-foundation";

export type RuntimeContextContinuity = {
  mode: "fresh" | "resumed" | "recovery";
  reason?: "provider_session_unavailable" | "provider_identity_changed";
  recovery: "provider_context" | "chrona_result_refs";
  providerSessionRef?: string;
};

type ExpectedProviderProvenance = {
  providerClientId: string;
  providerName: string;
  providerConfigFingerprint: string;
};

export async function resolveRuntimeContextContinuity(
  taskSessionId: string,
  expectedProvider: ExpectedProviderProvenance,
): Promise<RuntimeContextContinuity> {
  const [session, runCount] = await Promise.all([
    db.taskSession.findUnique({
      where: { id: taskSessionId },
      select: {
        providerSessionRef: true,
        providerClientId: true,
        providerName: true,
        providerConfigFingerprint: true,
      },
    }),
    db.run.count({ where: { taskSessionId } }),
  ]);
  const providerMatches =
    session?.providerClientId === expectedProvider.providerClientId
    && session.providerName === expectedProvider.providerName
    && session.providerConfigFingerprint === expectedProvider.providerConfigFingerprint;

  if (providerMatches && session.providerSessionRef?.trim()) {
    return {
      mode: "resumed",
      recovery: "provider_context",
      providerSessionRef: session.providerSessionRef.trim(),
    };
  }
  if (runCount > 1 || Boolean(session?.providerSessionRef)) {
    return {
      mode: "recovery",
      reason: providerMatches
        ? "provider_session_unavailable"
        : "provider_identity_changed",
      recovery: "chrona_result_refs",
    };
  }
  return { mode: "fresh", recovery: "provider_context" };
}

function providerRecord(
  value: ProviderJsonValue | undefined,
): Record<string, ProviderJsonValue> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, ProviderJsonValue>
    : {};
}

export function withContextContinuity(
  runtimeInput: Record<string, ProviderJsonValue>,
  continuity: RuntimeContextContinuity,
): Record<string, ProviderJsonValue> {
  const context = providerRecord(runtimeInput.context);
  const run = providerRecord(context.run);
  const { providerSessionRef: _providerSessionRef, ...publicContinuity } = continuity;
  return {
    ...runtimeInput,
    context: {
      ...context,
      run: {
        ...run,
        contextContinuity: publicContinuity,
      },
    },
  };
}

export function continuityInstructions(
  continuity: RuntimeContextContinuity,
): string {
  if (continuity.mode !== "recovery") return "";
  return "Provider conversation continuity is unavailable for this node. Do not assume prior provider turns are present. Recover required Chrona-owned facts through context.relevantPreviousResults nodeRef values and chrona_node_read before requesting business input. Never ask the user to re-enter an earlier node result.";
}
