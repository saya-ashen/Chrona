import { spawn, ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as readline from "node:readline";
import { fileURLToPath } from "node:url";

// ============================================================
// Runnable minimal OpenClaw calendar agent runtime
//
// What this file includes:
// - OpenClaw adapter only
// - working directory preparation
// - AGENTS.md injection
// - mock calendarctl CLI generation
// - OpenClaw JSON event parsing
// - intermediate decision extraction
// - structured result building + validation
// - demo entrypoint
//
// Run examples:
//   npm install -D typescript tsx @types/node
//   npx tsx calendar_agent_runtime.ts demo-mock
//   OPENCLAW_PATH=/usr/local/bin/openclaw npx tsx calendar_agent_runtime.ts demo-real
//
// Notes:
// - demo-mock does NOT require OpenClaw installed. It simulates an OpenClaw run.
// - demo-real requires OpenClaw installed and accessible.
// - The generated calendarctl is a mock tool used to explain the role of calendarctl.
// ============================================================

export type TaskType = "meeting_suggestion";
export type EventType =
  | "status"
  | "text"
  | "tool_use"
  | "tool_result"
  | "error"
  | "log";

export interface CalendarSuggestionRequest {
  taskType: TaskType;
  userId: string;
  attendees: string[];
  title?: string;
  durationMinutes: number;
  windowStart: string;
  windowEnd: string;
  constraints?: string[];
  preferencesSummary?: string[];
  sessionId?: string;
  timeoutMs?: number;
}

export interface AgentRunInput {
  request: CalendarSuggestionRequest;
  workingDirectory: string;
  openclawPath?: string;
  systemPrompt?: string;
  customArgs?: string[];
  useMockOpenClaw?: boolean;
}

export interface ToolUsePayload {
  callId: string;
  toolName: string;
  input: unknown;
}

export interface ToolResultPayload {
  callId: string;
  toolName: string;
  output: unknown;
  isError?: boolean;
}

export interface UsageStats {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export interface AgentEventBase {
  id: string;
  ts: number;
  type: EventType;
}

export interface StatusEvent extends AgentEventBase {
  type: "status";
  status:
    | "starting"
    | "running"
    | "completed"
    | "aborted"
    | "timeout"
    | "failed";
  detail?: string;
}

export interface TextEvent extends AgentEventBase {
  type: "text";
  text: string;
}

export interface ToolUseEvent extends AgentEventBase {
  type: "tool_use";
  payload: ToolUsePayload;
}

export interface ToolResultEvent extends AgentEventBase {
  type: "tool_result";
  payload: ToolResultPayload;
}

export interface ErrorEvent extends AgentEventBase {
  type: "error";
  message: string;
}

export interface LogEvent extends AgentEventBase {
  type: "log";
  text: string;
}

export type AgentEvent =
  | StatusEvent
  | TextEvent
  | ToolUseEvent
  | ToolResultEvent
  | ErrorEvent
  | LogEvent;

export interface IntermediateDecision {
  preferredSlotId?: string;
  alternativeSlotIds?: string[];
  rationale?: string;
}

export interface MeetingSuggestion {
  title: string;
  start: string;
  end: string;
  confidence: number;
  reason: string;
}

export interface MeetingSuggestionsV1 {
  suggestions: MeetingSuggestion[];
  warnings: string[];
  requiresConfirmation: boolean;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export interface AgentRunResult {
  sessionId: string;
  status: "completed" | "aborted" | "timeout" | "failed";
  rawText: string;
  usage?: UsageStats;
  toolTrace: Array<ToolUsePayload | ToolResultPayload>;
  intermediateDecision?: IntermediateDecision;
  structuredResult?: MeetingSuggestionsV1;
  validation?: ValidationResult;
  error?: string;
}

export interface AgentRunSession {
  sessionId: string;
  events: AsyncIterable<AgentEvent>;
  result: Promise<AgentRunResult>;
}

interface OpenClawJsonEvent {
  type?: string;
  text?: string;
  error?: string;
  tool?: string;
  call_id?: string;
  input?: unknown;
  output?: unknown;
  usage?: UsageStats;
}

interface AvailabilitySlot {
  slot_id: string;
  start: string;
  end: string;
}

function mkEvent<T extends AgentEvent>(event: Omit<T, "id" | "ts">): T {
  return {
    id: randomUUID(),
    ts: Date.now(),
    ...event,
  } as T;
}

function safeJsonParse<T = unknown>(value: string): T | null {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

class AsyncEventQueue<T> implements AsyncIterable<T> {
  private values: T[] = [];
  private resolvers: Array<(value: IteratorResult<T>) => void> = [];
  private ended = false;

  push(value: T): void {
    if (this.ended) return;
    const resolver = this.resolvers.shift();
    if (resolver) resolver({ value, done: false });
    else this.values.push(value);
  }

  end(): void {
    if (this.ended) return;
    this.ended = true;
    while (this.resolvers.length) {
      const resolver = this.resolvers.shift();
      resolver?.({ value: undefined as never, done: true });
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        if (this.values.length > 0) {
          return Promise.resolve({ value: this.values.shift()!, done: false });
        }
        if (this.ended) {
          return Promise.resolve({ value: undefined as never, done: true });
        }
        return new Promise<IteratorResult<T>>((resolve) => {
          this.resolvers.push(resolve);
        });
      },
    };
  }
}

function buildTaskPrompt(input: AgentRunInput): string {
  const req = input.request;
  const constraints = req.constraints?.length
    ? req.constraints.map((c) => `- ${c}`).join("\n")
    : "- No additional constraints";
  const prefs = req.preferencesSummary?.length
    ? req.preferencesSummary.map((p) => `- ${p}`).join("\n")
    : "- No summarized preferences";

  return [
    `Task: ${req.taskType}`,
    `User: ${req.userId}`,
    `Attendees: ${req.attendees.join(", ")}`,
    `Title: ${req.title ?? "Untitled meeting"}`,
    `Duration minutes: ${req.durationMinutes}`,
    `Window start: ${req.windowStart}`,
    `Window end: ${req.windowEnd}`,
    "",
    "Constraints:",
    constraints,
    "",
    "Preference summary:",
    prefs,
    "",
    "Use calendarctl for live calendar state.",
    "Do not guess missing facts.",
    "At the end, return a compact JSON object in this shape:",
    '{"preferredSlotId":"slot_2","alternativeSlotIds":["slot_3"],"rationale":"Best fit"}',
  ].join("\n");
}

function buildAgentsMd(): string {
  return [
    "# Calendar Agent Runtime",
    "",
    "You are operating inside a calendar scheduling environment.",
    "Use `calendarctl` for live calendar facts and actions.",
    "",
    "Rules:",
    "- Always use `--output json` for read operations.",
    "- Do not guess missing calendar state.",
    "- Query tools before making a recommendation.",
    "- Prefer draft actions over final irreversible actions.",
    "",
    "Available commands:",
    "- calendarctl list-events --user <id> --from <iso> --to <iso> --output json",
    "- calendarctl get-availability --attendees <comma-list> --from <iso> --to <iso> --duration-minutes <n> --output json",
    "- calendarctl get-preferences --user <id> --output json",
    "- calendarctl create-draft-event --title <title> --start <iso> --end <iso> --attendees <comma-list> --output json",
    "",
    "Suggested workflow:",
    "1. Read preferences.",
    "2. Read availability.",
    "3. Read existing events if needed.",
    "4. Choose the best slot and up to two alternatives.",
    "5. Return a compact JSON intermediate decision.",
  ].join("\n");
}

async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

async function writeFile(
  filePath: string,
  content: string,
  mode?: number,
): Promise<void> {
  await fs.writeFile(filePath, content, "utf8");
  if (mode) await fs.chmod(filePath, mode);
}

async function prepareRuntime(input: AgentRunInput): Promise<void> {
  await ensureDir(input.workingDirectory);
  await writeFile(
    path.join(input.workingDirectory, "AGENTS.md"),
    buildAgentsMd(),
  );
  await writeFile(
    path.join(input.workingDirectory, "calendarctl"),
    buildCalendarCtlScript(),
    0o755,
  );
}

function buildCalendarCtlScript(): string {
  return `#!/usr/bin/env node
const args = process.argv.slice(2);
const command = args[0];

function getArg(flag, fallback = '') {
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return fallback;
  return args[idx + 1];
}

function outputJson(obj) {
  process.stdout.write(JSON.stringify(obj));
}

if (!command) {
  console.error('calendarctl: missing command');
  process.exit(1);
}

if (command === 'get-preferences') {
  const user = getArg('--user', 'u_me');
  outputJson({
    user,
    preferences: {
      avoid_focus_time: true,
      prefer_morning: false,
      minimum_notice_minutes: 60,
      max_meetings_per_day: 5
    }
  });
  process.exit(0);
}

if (command === 'get-availability') {
  const attendees = getArg('--attendees', '').split(',').filter(Boolean);
  const durationMinutes = Number(getArg('--duration-minutes', '30'));
  outputJson({
    attendees,
    duration_minutes: durationMinutes,
    slots: [
      { slot_id: 'slot_1', start: '2026-04-21T13:30:00-07:00', end: '2026-04-21T14:00:00-07:00' },
      { slot_id: 'slot_2', start: '2026-04-21T15:30:00-07:00', end: '2026-04-21T16:00:00-07:00' },
      { slot_id: 'slot_3', start: '2026-04-21T16:30:00-07:00', end: '2026-04-21T17:00:00-07:00' }
    ]
  });
  process.exit(0);
}

if (command === 'list-events') {
  const user = getArg('--user', 'u_me');
  outputJson({
    user,
    events: [
      {
        id: 'evt_1',
        title: 'Design Review',
        start: '2026-04-21T10:00:00-07:00',
        end: '2026-04-21T11:00:00-07:00',
        busy: true
      },
      {
        id: 'evt_2',
        title: 'Focus Time',
        start: '2026-04-21T14:00:00-07:00',
        end: '2026-04-21T15:00:00-07:00',
        busy: true,
        type: 'focus'
      }
    ]
  });
  process.exit(0);
}

if (command === 'create-draft-event') {
  outputJson({
    draft_id: 'draft_789',
    status: 'created',
    title: getArg('--title', 'Suggested meeting'),
    start: getArg('--start', ''),
    end: getArg('--end', '')
  });
  process.exit(0);
}

console.error('calendarctl: unknown command', command);
process.exit(1);
`;
}

function buildMockOpenClawScript(): string {
  return `#!/usr/bin/env node
const { execFileSync } = require('node:child_process');
const cwd = process.cwd();

function emit(obj) {
  process.stderr.write(JSON.stringify(obj) + '\\n');
}

function runTool(callId, tool, args) {
  emit({ type: 'tool_use', call_id: callId, tool, input: args });
  const output = execFileSync('./calendarctl', args, { cwd, encoding: 'utf8' });
  emit({ type: 'tool_result', call_id: callId, tool, output: JSON.parse(output) });
}

emit({ type: 'step_start' });
runTool('call_pref', 'calendarctl.get-preferences', ['get-preferences', '--user', 'u_me', '--output', 'json']);
runTool('call_avail', 'calendarctl.get-availability', ['get-availability', '--attendees', 'u_me,u_alice', '--from', '2026-04-21T13:00:00-07:00', '--to', '2026-04-21T18:00:00-07:00', '--duration-minutes', '30', '--output', 'json']);
runTool('call_events', 'calendarctl.list-events', ['list-events', '--user', 'u_me', '--from', '2026-04-21T13:00:00-07:00', '--to', '2026-04-21T18:00:00-07:00', '--output', 'json']);
emit({ type: 'text', text: JSON.stringify({ preferredSlotId: 'slot_2', alternativeSlotIds: ['slot_3'], rationale: 'Avoids focus time and satisfies notice requirement' }) });
emit({ type: 'step_finish' });
process.exit(0);
`;
}

function extractIntermediateDecision(
  value: unknown,
): IntermediateDecision | undefined {
  if (!value || typeof value !== "object") return undefined;
  const obj = value as Record<string, unknown>;
  return {
    preferredSlotId:
      typeof obj.preferredSlotId === "string" ? obj.preferredSlotId : undefined,
    alternativeSlotIds: Array.isArray(obj.alternativeSlotIds)
      ? obj.alternativeSlotIds.filter((v): v is string => typeof v === "string")
      : undefined,
    rationale: typeof obj.rationale === "string" ? obj.rationale : undefined,
  };
}

function extractAvailabilitySlots(
  toolTrace: Array<ToolUsePayload | ToolResultPayload>,
): AvailabilitySlot[] {
  for (const item of toolTrace) {
    if (!("output" in item)) continue;
    if (
      item.toolName !== "calendarctl.get-availability" &&
      item.toolName !== "get-availability"
    )
      continue;
    const output = item.output as any;
    if (!Array.isArray(output?.slots)) continue;
    return output.slots.filter(
      (s: any) =>
        s &&
        typeof s.slot_id === "string" &&
        typeof s.start === "string" &&
        typeof s.end === "string",
    );
  }
  return [];
}

function buildMeetingSuggestionsFromTrace(
  input: AgentRunInput,
  decision: IntermediateDecision | undefined,
  toolTrace: Array<ToolUsePayload | ToolResultPayload>,
): MeetingSuggestionsV1 {
  const warnings: string[] = [];
  const slots = extractAvailabilitySlots(toolTrace);

  if (!decision?.preferredSlotId) {
    warnings.push("No preferred slot selected by agent");
    return { suggestions: [], warnings, requiresConfirmation: true };
  }

  const preferred = slots.find(
    (slot) => slot.slot_id === decision.preferredSlotId,
  );
  if (!preferred) {
    warnings.push(
      `Preferred slot ${decision.preferredSlotId} not found in availability output`,
    );
    return { suggestions: [], warnings, requiresConfirmation: true };
  }

  return {
    suggestions: [
      {
        title: input.request.title ?? "Suggested meeting",
        start: preferred.start,
        end: preferred.end,
        confidence: 0.9,
        reason: decision.rationale ?? "Best available option selected by agent",
      },
    ],
    warnings,
    requiresConfirmation: false,
  };
}

function validateMeetingSuggestions(
  result: MeetingSuggestionsV1,
): ValidationResult {
  const errors: string[] = [];

  if (!Array.isArray(result.suggestions))
    errors.push("suggestions must be an array");
  if (!Array.isArray(result.warnings)) errors.push("warnings must be an array");
  if (typeof result.requiresConfirmation !== "boolean")
    errors.push("requiresConfirmation must be a boolean");

  result.suggestions.forEach((s, i) => {
    if (!s.title) errors.push(`suggestions[${i}].title missing`);
    if (!s.start) errors.push(`suggestions[${i}].start missing`);
    if (!s.end) errors.push(`suggestions[${i}].end missing`);
    if (typeof s.reason !== "string" || !s.reason)
      errors.push(`suggestions[${i}].reason missing`);
    if (
      typeof s.confidence !== "number" ||
      s.confidence < 0 ||
      s.confidence > 1
    ) {
      errors.push(`suggestions[${i}].confidence invalid`);
    }
  });

  return { valid: errors.length === 0, errors };
}

function waitForExit(
  child: ChildProcessWithoutNullStreams,
): Promise<number | null> {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => resolve(code));
  });
}

class OpenClawAdapter {
  run(input: AgentRunInput): AgentRunSession {
    const sessionId = input.request.sessionId ?? randomUUID();
    const queue = new AsyncEventQueue<AgentEvent>();
    const result = this.execute(input, sessionId, queue);
    return { sessionId, events: queue, result };
  }

  private async execute(
    input: AgentRunInput,
    sessionId: string,
    queue: AsyncEventQueue<AgentEvent>,
  ): Promise<AgentRunResult> {
    await prepareRuntime(input);

    let executable =
      input.openclawPath ?? process.env.OPENCLAW_PATH ?? "openclaw";
    let args: string[];

    if (input.useMockOpenClaw) {
      const mockPath = path.join(input.workingDirectory, "mock-openclaw.js");
      await writeFile(mockPath, buildMockOpenClawScript(), 0o755);
      executable = process.execPath;
      args = [mockPath];
    } else {
      args = [
        "agent",
        "--local",
        "--json",
        "--session-id",
        sessionId,
        "--message",
        buildTaskPrompt(input),
        ...(input.systemPrompt ? ["--system-prompt", input.systemPrompt] : []),
        ...(input.customArgs ?? []),
      ];
    }

    const toolTrace: Array<ToolUsePayload | ToolResultPayload> = [];
    const rawTextParts: string[] = [];
    let usage: UsageStats | undefined;
    let intermediateDecision: IntermediateDecision | undefined;

    queue.push(
      mkEvent<StatusEvent>({
        type: "status",
        status: "starting",
        detail: "Preparing OpenClaw runtime",
      }),
    );

    const child = spawn(executable, args, {
      cwd: input.workingDirectory,
      env: {
        ...process.env,
        PATH: `${input.workingDirectory}${path.delimiter}${process.env.PATH ?? ""}`,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    queue.push(
      mkEvent<StatusEvent>({
        type: "status",
        status: "running",
        detail: "OpenClaw running",
      }),
    );

    const stdoutRl = readline.createInterface({ input: child.stdout });
    const stderrRl = readline.createInterface({ input: child.stderr });

    const handleLine = (line: string) => {
      const parsed = safeJsonParse<OpenClawJsonEvent>(line);
      if (!parsed || typeof parsed !== "object") {
        queue.push(mkEvent<LogEvent>({ type: "log", text: line }));
        return;
      }

      switch (parsed.type) {
        case "text": {
          const text = parsed.text ?? "";
          rawTextParts.push(text);
          queue.push(mkEvent<TextEvent>({ type: "text", text }));
          const maybeDecision = safeJsonParse(text);
          if (maybeDecision) {
            const extracted = extractIntermediateDecision(maybeDecision);
            if (extracted) intermediateDecision = extracted;
          }
          break;
        }
        case "tool_use": {
          const payload: ToolUsePayload = {
            callId: parsed.call_id ?? randomUUID(),
            toolName: parsed.tool ?? "unknown_tool",
            input: parsed.input,
          };
          toolTrace.push(payload);
          queue.push(mkEvent<ToolUseEvent>({ type: "tool_use", payload }));
          break;
        }
        case "tool_result": {
          const payload: ToolResultPayload = {
            callId: parsed.call_id ?? randomUUID(),
            toolName: parsed.tool ?? "unknown_tool",
            output: parsed.output,
            isError: false,
          };
          toolTrace.push(payload);
          queue.push(
            mkEvent<ToolResultEvent>({ type: "tool_result", payload }),
          );
          break;
        }
        case "error": {
          queue.push(
            mkEvent<ErrorEvent>({
              type: "error",
              message: parsed.error ?? "Unknown OpenClaw error",
            }),
          );
          break;
        }
        case "step_start": {
          queue.push(
            mkEvent<StatusEvent>({
              type: "status",
              status: "running",
              detail: "Step started",
            }),
          );
          break;
        }
        case "step_finish": {
          queue.push(
            mkEvent<StatusEvent>({
              type: "status",
              status: "running",
              detail: "Step finished",
            }),
          );
          break;
        }
        default: {
          if (parsed.usage) usage = parsed.usage;
          queue.push(
            mkEvent<LogEvent>({ type: "log", text: JSON.stringify(parsed) }),
          );
        }
      }
    };

    stdoutRl.on("line", handleLine);
    stderrRl.on("line", handleLine);

    let exitCode: number | null;
    try {
      exitCode = await waitForExit(child);
    } catch (error) {
      queue.push(
        mkEvent<ErrorEvent>({ type: "error", message: String(error) }),
      );
      exitCode = 1;
    }

    stdoutRl.close();
    stderrRl.close();

    const structuredResult = buildMeetingSuggestionsFromTrace(
      input,
      intermediateDecision,
      toolTrace,
    );
    const validation = validateMeetingSuggestions(structuredResult);
    const status: AgentRunResult["status"] =
      exitCode === 0 ? "completed" : "failed";

    queue.push(
      mkEvent<StatusEvent>({
        type: "status",
        status,
        detail:
          status === "completed" ? "OpenClaw finished" : "OpenClaw failed",
      }),
    );
    queue.end();

    return {
      sessionId,
      status,
      rawText: rawTextParts.join(""),
      usage,
      toolTrace,
      intermediateDecision,
      structuredResult,
      validation,
      error:
        status === "failed"
          ? `OpenClaw exited with code ${String(exitCode)}`
          : undefined,
    };
  }
}

export async function generateMeetingSuggestions(
  input: AgentRunInput,
): Promise<AgentRunResult> {
  const adapter = new OpenClawAdapter();
  const session = adapter.run(input);

  for await (const event of session.events) {
    switch (event.type) {
      case "status":
        console.log("[status]", event.status, event.detail ?? "");
        break;
      case "text":
        console.log("[text]", event.text);
        break;
      case "tool_use":
        console.log(
          "[tool_use]",
          event.payload.toolName,
          JSON.stringify(event.payload.input),
        );
        break;
      case "tool_result":
        console.log(
          "[tool_result]",
          event.payload.toolName,
          JSON.stringify(event.payload.output),
        );
        break;
      case "error":
        console.error("[error]", event.message);
        break;
      case "log":
        console.log("[log]", event.text);
        break;
    }
  }

  return session.result;
}

async function runDemo(useMockOpenClaw: boolean): Promise<void> {
  const cwd = path.join(process.cwd(), ".calendar-agent-demo");
  const input: AgentRunInput = {
    workingDirectory: cwd,
    useMockOpenClaw,
    request: {
      taskType: "meeting_suggestion",
      userId: "u_me",
      attendees: ["u_me", "u_alice"],
      title: "1:1 with Alice",
      durationMinutes: 30,
      windowStart: "2026-04-21T13:00:00-07:00",
      windowEnd: "2026-04-21T18:00:00-07:00",
      constraints: ["Avoid focus time", "Require at least 60 minutes notice"],
      preferencesSummary: [
        "Avoid focus blocks",
        "Prefer minimal context switching",
      ],
      timeoutMs: 30_000,
    },
  };

  const result = await generateMeetingSuggestions(input);
  console.log("\n=== FINAL RESULT ===");
  console.log(JSON.stringify(result, null, 2));
}

const __filename = fileURLToPath(import.meta.url);
const isDirectRun = process.argv[1] === __filename;

if (isDirectRun) {
  const cmd = process.argv[2];
  if (cmd === "demo-mock") {
    runDemo(true).catch((err) => {
      console.error(err);
      process.exit(1);
    });
  } else if (cmd === "demo-real") {
    runDemo(false).catch((err) => {
      console.error(err);
      process.exit(1);
    });
  } else {
    console.log("Usage:");
    console.log("  npx tsx calendar_agent_runtime.ts demo-mock");
    console.log(
      "  OPENCLAW_PATH=/path/to/openclaw npx tsx calendar_agent_runtime.ts demo-real",
    );
  }
}
