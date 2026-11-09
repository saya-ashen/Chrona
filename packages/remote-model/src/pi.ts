import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, sep } from "node:path";
import { createPiProvider, launchPiProcess } from "@chrona/pi";
import type { ProviderEvents } from "@chrona/contracts/steward";
import { createRemoteModelGateway, type RemoteModelGatewayInput } from "./gateway";

export type RemotePiInput = RemoteModelGatewayInput & {
  command: string; expectedVersion: string; helperPath: string; chronaExtension: string;
  /** Private device-owned directory, separate from the approved work directory. */
  profileRoot: string; cwd: string; goal: string;
  execution: { workId: string; sessionId: string; runId: string; attemptId: string };
  budget: RemoteModelGatewayInput["budget"] & { timeoutMs: number; maxToolCalls: number };
  onText(text: string): void;
  events?: ProviderEvents;
};
const overlaps = (root: string, work: string) => { const path = relative(root, work); return path === "" || path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path); };
function profileLocation(input: RemotePiInput) {
  if (input.expectedVersion !== "1.5.0" || ![input.command, input.helperPath, input.chronaExtension, input.profileRoot].every(isAbsolute)) throw new Error("Remote Pi requires explicit 1.5.0 executable and resources");
  const cwd = realpathSync(input.cwd), root = realpathSync(input.profileRoot);
  if (overlaps(cwd, root) || overlaps(root, cwd)) throw new Error("Remote Pi profile must be separate from approved workspace");
  return { cwd, root };
}
/** Actual Pi RPC uses the public provider state machine, including model pin,
 * resource attestation, pre-tool admission, disabled retries/compaction, hard
 * deadline, and descendant-stop proof. It receives only a loopback credential,
 * never device/app credentials or host provider keys. */
export function startRemotePi(input: RemotePiInput) {
  const { cwd, root } = profileLocation(input);
  const startedAt = Date.now(), deadlineAt = Math.min(startedAt + input.budget.timeoutMs, Date.parse(input.deadlineAt));
  if (!Number.isSafeInteger(input.budget.maxToolCalls) || input.budget.maxToolCalls < 1 || input.budget.maxToolCalls > 60 || !Number.isFinite(deadlineAt) || deadlineAt <= startedAt) throw new Error("Invalid Remote Pi execution budget");
  const deadline = new Date(deadlineAt);
  const profile = mkdtempSync(join(root, "pi-"));
  let gateway: ReturnType<typeof createRemoteModelGateway>;
  try { gateway = createRemoteModelGateway({ ...input, deadlineAt: deadline.toISOString() }); }
  catch (error) { rmSync(profile, { recursive: true, force: true }); throw error; }
  try {
    mkdirSync(join(profile, "home"), { mode: 0o700 });
    writeFileSync(join(profile, "auth.json"), "{}", { mode: 0o600 });
    writeFileSync(join(profile, "settings.json"), JSON.stringify({ retry: { enabled: false }, compaction: { enabled: false }, packages: [] }), { mode: 0o600 });
    writeFileSync(join(profile, "models.json"), JSON.stringify({ providers: { "chrona-remote": {
      baseUrl: gateway.baseUrl, api: "openai-completions", apiKey: gateway.token,
      compat: { supportsDeveloperRole: false, supportsReasoningEffort: false, supportsStore: false, maxTokensField: "max_tokens" },
      models: [{ id: "execution", name: "Governed remote text/tools", reasoning: false, input: ["text"], contextWindow: 200_000, maxTokens: input.budget.maxOutputTokens, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
    } } }), { mode: 0o600 });
    const provider = createPiProvider({ command: input.command, expectedVersion: input.expectedVersion, agentDir: profile, chronaExtension: input.chronaExtension,
      agentUrl: "http://127.0.0.1:1/api/steward-agent", processHelper: input.helperPath,
      launch: launch => launchPiProcess({ ...launch, timeoutMs: Math.max(1, deadline.getTime() - Date.now()),
        args: launch.args.includes("--version") ? launch.args : [...launch.args, "--offline", "--no-mcp", "--thinking", "off"],
        // An allowlist built from scratch also strips proxy variables, user Pi
        // configuration, cloud credentials and every provider API key.
        env: { PATH: process.env.PATH, LANG: "C.UTF-8", HOME: join(profile, "home"), PI_CODING_AGENT_DIR: launch.env.PI_CODING_AGENT_DIR,
          PI_SKIP_VERSION_CHECK: "1", PI_TELEMETRY: "0", CHRONA_EXECUTION_MAX_TOOL_CALLS: String(input.budget.maxToolCalls) },
      }),
    });
    const handle = provider.start({ runId: input.execution.runId, token: "", lane: "background", cwd, sessionDir: join(profile, "sessions"), sessionId: null,
      execution: { workId: input.execution.workId, sessionId: input.execution.sessionId, runId: input.execution.runId, attemptId: input.execution.attemptId }, prompt: input.goal, systemPrompt: "Complete the authorized task in the approved working directory using the available native tools.",
      resources: "minimal", model: "chrona-remote/execution", deadline, executionBudget: { maxToolCalls: input.budget.maxToolCalls }, events: input.events,
      detail: { async append(event) { if (event.payload.type === "text_delta") input.onText(event.payload.delta); } },
    });
    const done = handle.done.then(result => { gateway.close(); rmSync(profile, { recursive: true, force: true }); return result; }, error => { gateway.close(); throw error; });
    return { done, abort: () => handle.abort(), inject: (text: string) => handle.inject(text) };
  } catch (error) { gateway.close(); rmSync(profile, { recursive: true, force: true }); throw error; }
}
