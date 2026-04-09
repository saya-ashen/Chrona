import type { OpenClawRuntimeClient } from "@/modules/runtime/openclaw/client";
import type { GateCheckResult, GateReport } from "@/modules/runtime/openclaw/types";

export const OPENCLAW_PROBE_PROMPT =
  "Probe: summarize your current status and continue if approvals are supported.";

type OpenClawProbeOptions = {
  historyTimeoutMs?: number;
  pollIntervalMs?: number;
  sleep?: (ms: number) => Promise<void>;
};

const DEFAULT_HISTORY_TIMEOUT_MS = 15_000;
const DEFAULT_POLL_INTERVAL_MS = 1_000;

function toErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

async function defaultSleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForTranscriptMessages(
  client: OpenClawRuntimeClient,
  runtimeSessionKey: string | undefined,
  options: OpenClawProbeOptions,
) {
  if (!runtimeSessionKey) {
    return { messages: [] };
  }

  const historyTimeoutMs = options.historyTimeoutMs ?? DEFAULT_HISTORY_TIMEOUT_MS;
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const sleep = options.sleep ?? defaultSleep;
  const startedAt = Date.now();

  for (;;) {
    const history = await client.readOutputs(runtimeSessionKey);
    if (history.messages.length > 0) {
      return history;
    }

    if (Date.now() - startedAt >= historyTimeoutMs) {
      return history;
    }

    await sleep(pollIntervalMs);
  }
}

export async function collectOpenClawGateChecks(
  client: OpenClawRuntimeClient,
  options: OpenClawProbeOptions = {},
): Promise<GateCheckResult[]> {
  const created = await client.createRun({ prompt: OPENCLAW_PROBE_PROMPT });

  const snapshot = created.runtimeRunRef
    ? await client.waitForRun(created.runtimeRunRef, 250)
    : undefined;

  const history = await waitForTranscriptMessages(client, created.runtimeSessionKey, options);

  let approvalEvidence = "approval request not attempted";
  let approvalPassed = false;

  try {
    const approval = await client.requestApproval({
      command: "printf openclaw-feasibility",
      cwd: ".",
      host: "gateway",
      sessionKey: created.runtimeSessionKey,
    });

    if (approval.approvalId) {
      const resolved = await client.resolveApproval({
        approvalId: approval.approvalId,
        decision: "approve",
      });
      approvalPassed = resolved.accepted;
      approvalEvidence = resolved.accepted
        ? `${approval.approvalId} resolved`
        : `${approval.approvalId} not resolved`;
    } else {
      approvalEvidence = "approval id missing";
    }
  } catch (error) {
    approvalEvidence = toErrorMessage(error);
  }

  return [
    {
      name: "create_run",
      passed: Boolean(created.runtimeRunRef),
      evidence: created.runtimeRunRef ?? "no run id returned",
    },
    {
      name: "query_status",
      passed: Boolean(snapshot?.rawStatus),
      evidence: snapshot?.rawStatus ?? "no status returned",
    },
    {
      name: "read_outputs",
      passed: history.messages.length > 0,
      evidence: `${history.messages.length} transcript messages`,
    },
    {
      name: "resume_after_wait",
      passed: approvalPassed,
      evidence: approvalEvidence,
    },
  ];
}

export function renderOpenClawGateMarkdown(report: GateReport) {
  return [
    "# OpenClaw Feasibility Gate",
    "",
    `Overall: ${report.overall.toUpperCase()}`,
    "",
    ...report.checks.map(
      (check) => `- ${check.name}: ${check.passed ? "PASS" : "FAIL"} (${check.evidence})`,
    ),
    "",
  ].join("\n");
}
