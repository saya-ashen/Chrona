/**
 * normalizers.ts — pure mapping from Claude Code stream items to
 * `ProviderRunEvent`s.
 *
 * No IO, no env reads, no process spawning. The runner feeds raw items
 * (one per `query().next()` or one per NDJSON line) into
 * `mapClaudeCodeStreamItems` and gets back a flat batch of `ProviderRunEvent`s.
 *
 * Mapping table is from `plan.md` §0.2.
 *
 * Spec:  specs/017-provider-claude-code/spec.md §5
 * Plan:   specs/017-provider-claude-code/plan.md §0.2
 */

import type {
  ProviderRunEvent,
  ProviderRunRef,
} from "@chrona/providers-foundation";

import {
  buildBaseRef,
  buildEvent,
  buildRawEvent,
  normalizeUsage,
} from "./normalizer-builders";

/* -------------------------------------------------------------------------- */
/*                                 Public API                                  */
/* -------------------------------------------------------------------------- */

export interface NormalizerOptions {
  /** When true, any non-success `result` terminal maps to `run_cancelled` instead of `run_failed`. */
  cancelRequested: boolean;
  /** When true, throw on unrecognized stream `type` instead of mapping to `raw_event`. */
  strictUnknownEvents?: boolean;
  /** Provider name stamped onto every event. */
  provider?: string;
  /** Per-run ref seeded into `run_started` / `run_completed`. */
  baseRef?: ProviderRunRef;
}

/**
 * Per-run state owned by the normalizer. Lives on `ClaudeCodeRunHandle.normalizer`
 * so deltas that span multiple raw items (e.g. `input_json_delta` chunks that
 * build up a single tool call's `input`) can accumulate between calls.
 */
export interface NormalizerContext {
  /** In-flight tool_use_id → accumulated `input_json` string. */
  toolInputBuffers: Map<string, string>;
  /** In-flight tool_use_id → tool name. */
  toolNames: Map<string, string>;
  /** content_block index → tool_use_id (most recently started). */
  indexToCallId: Map<number, string>;
  /** Cumulative text so far per assistant turn. */
  turnTextBuffer: string;
  /** Sequence number for emitted events. */
  sequence: number;
  /** Resolved strict-unknown-events flag. */
  strictUnknownEvents: boolean;
}

export function createNormalizerContext(
  opts: { strictUnknownEvents?: boolean } = {},
): NormalizerContext {
  return {
    toolInputBuffers: new Map(),
    toolNames: new Map(),
    indexToCallId: new Map(),
    turnTextBuffer: "",
    sequence: 0,
    strictUnknownEvents: opts.strictUnknownEvents ?? false,
  };
}

/**
 * Map a batch of raw Claude Code stream items to a flat batch of
 * `ProviderRunEvent`s. The function is pure given a stable `ctx`.
 *
 * `items` is the union of:
 *   - a single parsed NDJSON line from `claude -p --output-format stream-json`
 *   - a single value yielded by the SDK's `query()` async generator
 */
export function mapClaudeCodeStreamItems(
  items: readonly unknown[],
  ctx: NormalizerContext,
  options: NormalizerOptions,
): ProviderRunEvent[] {
  const out: ProviderRunEvent[] = [];
  for (const item of items) {
    if (item == null) continue;
    pushMapped(out, item, ctx, options);
  }
  return out;
}

function pushMapped(
  out: ProviderRunEvent[],
  item: unknown,
  ctx: NormalizerContext,
  options: NormalizerOptions,
): void {
  if (typeof item !== "object") {
    out.push(buildRawEvent(ctx, options, item, undefined));
    return;
  }
  const rec = item as Record<string, unknown>;
  const type = typeof rec.type === "string" ? rec.type : undefined;
  if (!type) {
    out.push(buildRawEvent(ctx, options, item, undefined));
    return;
  }

  switch (type) {
    case "system":
      pushSystem(out, rec, type, ctx, options);
      return;
    case "assistant":
      pushAssistant(out, rec, ctx, options);
      return;
    case "user":
      pushUser(out, rec, ctx, options);
      return;
    case "stream_event":
      pushStreamEvent(out, rec, item, type, ctx, options);
      return;
    case "result":
      pushResult(out, rec, ctx, options);
      return;
    case "tool_use_summary":
    case "tool_progress":
    case "auth_status":
    case "task_notification":
    case "rate_limit_event":
    case "files_persisted":
    case "session_state_changed":
    case "commands_changed":
      out.push(buildRawEvent(ctx, options, item, type));
      return;
    default:
      if (options.strictUnknownEvents || ctx.strictUnknownEvents) {
        throw new Error(
          `ClaudeCode normalizer: unrecognized stream type "${type}" (strict mode)`,
        );
      }
      out.push(buildRawEvent(ctx, options, item, type));
      return;
  }
}

function pushSystem(
  out: ProviderRunEvent[],
  rec: Record<string, unknown>,
  type: string,
  ctx: NormalizerContext,
  options: NormalizerOptions,
): void {
  const subtype = typeof rec.subtype === "string" ? rec.subtype : undefined;
  if (subtype === "init") {
    const ref = buildBaseRef(rec, options);
    out.push(
      buildEvent(ctx, options, {
        type: "run_started",
        run: ref,
        sessionId: typeof rec.session_id === "string" ? rec.session_id : ref.sessionId,
      }),
    );
    return;
  }
  out.push(buildRawEvent(ctx, options, rec, type));
}

function pushAssistant(
  out: ProviderRunEvent[],
  rec: Record<string, unknown>,
  ctx: NormalizerContext,
  options: NormalizerOptions,
): void {
  if (typeof rec.error === "string") {
    out.push(
      buildEvent(ctx, options, {
        type: "run_failed",
        error: sdkErrorMessage(rec, "Claude Code assistant error"),
      }),
    );
    return;
  }
  const message = rec.message as
    | { content?: ReadonlyArray<Record<string, unknown>> }
    | undefined;
  const blocks = message?.content ?? [];
  const before = out.length;
  for (const block of blocks) {
    if (block.type === "text" && typeof block.text === "string") {
      out.push(
        buildEvent(ctx, options, { type: "text_delta", text: block.text }),
      );
    } else if (block.type === "tool_use" && typeof block.id === "string") {
      registerToolUse(ctx, block);
      out.push(
        buildEvent(ctx, options, {
          type: "tool_call",
          tool: ctx.toolNames.get(block.id) ?? "unknown_tool",
          callId: block.id,
          input: (block.input as Record<string, unknown> | undefined) ?? {},
          status: "pending",
        }),
      );
    } else if (
      block.type === "thinking" &&
      typeof block.thinking === "string"
    ) {
      out.push(
        buildEvent(ctx, options, { type: "reasoning_delta", text: block.thinking }),
      );
    }
  }
  if (out.length === before) {
    out.push(buildRawEvent(ctx, options, rec, "assistant"));
  }
}

function registerToolUse(
  ctx: NormalizerContext,
  block: Record<string, unknown>,
): void {
  const callId = String(block.id);
  const toolName = typeof block.name === "string" ? block.name : "unknown_tool";
  ctx.toolNames.set(callId, toolName);
  ctx.toolInputBuffers.set(callId, "");
}

function pushUser(
  out: ProviderRunEvent[],
  rec: Record<string, unknown>,
  ctx: NormalizerContext,
  options: NormalizerOptions,
): void {
  const message = rec.message as
    | { content?: ReadonlyArray<Record<string, unknown>> }
    | undefined;
  const blocks = message?.content ?? [];
  const before = out.length;
  for (const block of blocks) {
    if (block.type === "tool_result" && typeof block.tool_use_id === "string") {
      const callId = block.tool_use_id;
      const toolName = ctx.toolNames.get(callId) ?? "unknown_tool";
      out.push(
        buildEvent(ctx, options, {
          type: "tool_result",
          tool: toolName,
          callId,
          result: block.content ?? null,
        }),
      );
      ctx.toolInputBuffers.delete(callId);
      ctx.toolNames.delete(callId);
    }
  }
  if (out.length === before) {
    out.push(buildRawEvent(ctx, options, rec, "user"));
  }
}

function pushStreamEvent(
  out: ProviderRunEvent[],
  rec: Record<string, unknown>,
  item: unknown,
  type: string,
  ctx: NormalizerContext,
  options: NormalizerOptions,
): void {
  const ev = rec.event as Record<string, unknown> | undefined;
  if (!ev) {
    out.push(buildRawEvent(ctx, options, item, type));
    return;
  }
  mapStreamEvent(out, ev, ctx, options);
}

function sdkErrorMessage(rec: Record<string, unknown>, fallback: string): string {
  const errors = Array.isArray(rec.errors) && rec.errors.length > 0
    ? (rec.errors as unknown[]).map(String).join("; ")
    : null;
  const apiStatus = typeof rec.api_error_status === "number" ? rec.api_error_status : null;
  const assistantError = typeof rec.error === "string" ? rec.error : null;
  const terminalReason = typeof rec.terminal_reason === "string" ? rec.terminal_reason : null;

  if (apiStatus) {
    const base = apiStatus === 401
      ? "Claude Code API request failed with HTTP 401 (authentication failed)."
      : `Claude Code API request failed with HTTP ${apiStatus}.`;
    return errors ? `${base} ${errors}` : base;
  }
  if (assistantError) return `Claude Code assistant error: ${assistantError}`;
  if (errors) return errors;
  if (terminalReason) return `Claude Code run failed (${terminalReason})`;
  return fallback;
}

function pushResult(
  out: ProviderRunEvent[],
  rec: Record<string, unknown>,
  ctx: NormalizerContext,
  options: NormalizerOptions,
): void {
  const subtype = typeof rec.subtype === "string" ? rec.subtype : "success";
  const ref = buildBaseRef(rec, options);
  const apiStatus = typeof rec.api_error_status === "number" ? rec.api_error_status : null;
  if (rec.is_error === true || apiStatus !== null) {
    out.push(
      buildEvent(ctx, options, {
        type: "run_failed",
        run: ref,
        error: sdkErrorMessage(rec, `Claude Code run failed (${subtype})`),
      }),
    );
    return;
  }
  if (subtype === "success") {
    out.push(
      buildEvent(ctx, options, {
        type: "run_completed",
        run: ref,
        outputText: typeof rec.result === "string" ? rec.result : undefined,
        output: typeof rec.result === "string" ? { text: rec.result } : undefined,
        usage: normalizeUsage(rec.usage),
      }),
    );
    return;
  }
  // Cancel wins: once the caller has requested cancellation, the SDK's
  // post-interrupt `result` message can carry any non-success subtype
  // (`error_during_execution`, `error`, an abort-induced code, …). Treating
  // a user-initiated cancel as a failure surfaces a misleading "failed"
  // badge, so any non-success terminal after a cancel maps to run_cancelled.
  // This aligns the event stream with `snapshot()`, which already reports
  // "cancelled" whenever `cancelRequested` is set.
  if (options.cancelRequested) {
    out.push(buildEvent(ctx, options, { type: "run_cancelled", run: ref }));
    return;
  }
  out.push(
    buildEvent(ctx, options, {
      type: "run_failed",
      run: ref,
      error: sdkErrorMessage(rec, `Claude Code run failed (${subtype})`),
    }),
  );
}

/* -------------------------------------------------------------------------- */
/*                       stream_event sub-message mapping                     */
/* -------------------------------------------------------------------------- */

function mapStreamEvent(
  out: ProviderRunEvent[],
  ev: Record<string, unknown>,
  ctx: NormalizerContext,
  options: NormalizerOptions,
): void {
  const evType = typeof ev.type === "string" ? ev.type : undefined;
  if (evType === "content_block_start") {
    mapContentBlockStart(out, ev, ctx, options);
    return;
  }
  if (evType === "content_block_delta") {
    mapContentBlockDelta(out, ev, ctx, options);
    return;
  }
  if (evType === "content_block_stop") {
    mapContentBlockStop(out, ev, ctx, options);
    return;
  }
  out.push(buildRawEvent(ctx, options, ev, evType));
}

function mapContentBlockStart(
  out: ProviderRunEvent[],
  ev: Record<string, unknown>,
  ctx: NormalizerContext,
  options: NormalizerOptions,
): void {
  const block = ev.content_block as Record<string, unknown> | undefined;
  if (block?.type === "tool_use" && typeof block.id === "string") {
    const toolName = typeof block.name === "string" ? block.name : "unknown_tool";
    ctx.toolNames.set(block.id, toolName);
    ctx.toolInputBuffers.set(block.id, "");
    const idx = typeof ev.index === "number" ? ev.index : -1;
    if (idx >= 0) ctx.indexToCallId.set(idx, block.id);
    out.push(
      buildEvent(ctx, options, {
        type: "tool_started",
        toolName,
        preview: { id: block.id, name: toolName },
      }),
    );
    return;
  }
  out.push(buildRawEvent(ctx, options, ev, "content_block_start"));
}

function mapContentBlockDelta(
  out: ProviderRunEvent[],
  ev: Record<string, unknown>,
  ctx: NormalizerContext,
  options: NormalizerOptions,
): void {
  const delta = ev.delta as Record<string, unknown> | undefined;
  if (delta?.type === "text_delta" && typeof delta.text === "string") {
    out.push(buildEvent(ctx, options, { type: "text_delta", text: delta.text }));
    return;
  }
  if (delta?.type === "input_json_delta" && typeof delta.partial_json === "string") {
    const idx = typeof ev.index === "number" ? ev.index : -1;
    const callId = ctx.indexToCallId.get(idx);
    if (callId) {
      const buf = ctx.toolInputBuffers.get(callId) ?? "";
      ctx.toolInputBuffers.set(callId, buf + delta.partial_json);
    }
    out.push(
      buildEvent(ctx, options, {
        type: "raw_event",
        rawEventType: "content_block_delta/input_json_delta",
        raw: ev,
      } as never),
    );
    return;
  }
  if (delta?.type === "thinking_delta" && typeof delta.thinking === "string") {
    out.push(
      buildEvent(ctx, options, { type: "reasoning_delta", text: delta.thinking }),
    );
    return;
  }
  out.push(buildRawEvent(ctx, options, ev, "content_block_delta"));
}

function mapContentBlockStop(
  out: ProviderRunEvent[],
  ev: Record<string, unknown>,
  ctx: NormalizerContext,
  options: NormalizerOptions,
): void {
  const idx = typeof ev.index === "number" ? ev.index : -1;
  const callId = ctx.indexToCallId.get(idx);
  if (!callId) {
    out.push(buildRawEvent(ctx, options, ev, "content_block_stop"));
    return;
  }
  const toolName = ctx.toolNames.get(callId) ?? "unknown_tool";
  const parsedInput = parseBufferedToolInput(ctx.toolInputBuffers.get(callId));
  out.push(
    buildEvent(ctx, options, {
      type: "tool_call",
      tool: toolName,
      callId,
      input: parsedInput,
      status: "pending",
    }),
  );
  out.push(
    buildEvent(ctx, options, {
      type: "tool_completed",
      toolName,
    }),
  );
  ctx.toolInputBuffers.delete(callId);
  ctx.indexToCallId.delete(idx);
}

function parseBufferedToolInput(buffer: string | undefined): Record<string, unknown> {
  if (!buffer) return {};
  try {
    const parsed = JSON.parse(buffer) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : { value: parsed };
  } catch {
    return { raw: buffer };
  }
}

