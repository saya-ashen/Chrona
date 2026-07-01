/**
 * normalizer-builders — per-type event builders + dispatch + stamp.
 *
 * Kept out of `normalizers.ts` to keep that file's `max-lines` under 500.
 * The builders produce a fully-typed `ProviderRunEvent` literal so callers
 * never have to widen a union back from a `Partial`. Only `raw_event`
 * carries the full `raw` payload; the foundation schema restricts `raw`
 * to that variant, so other builders do not accept it.
 */

import {
  providerRunEventSchema,
  type ProviderRunEvent,
  type ProviderRunRef,
  type ProviderUsage,
} from "@chrona/providers-foundation";

import type { NormalizerContext, NormalizerOptions } from "./normalizers";

export const builders = {
  run_started(ctx: NormalizerContext, options: NormalizerOptions, args: {
    run: ProviderRunRef;
    sessionId?: string;
  }): ProviderRunEvent {
    return stamp(ctx, options, {
      type: "run_started",
      run: args.run,
      sessionId: args.sessionId,
    });
  },
  text_delta(ctx: NormalizerContext, options: NormalizerOptions, args: {
    text: string;
  }): ProviderRunEvent {
    return stamp(ctx, options, { type: "text_delta", text: args.text });
  },
  tool_call(ctx: NormalizerContext, options: NormalizerOptions, args: {
    tool: string;
    callId: string;
    input: Record<string, unknown>;
    status: "pending" | "completed" | "error";
  }): ProviderRunEvent {
    return stamp(ctx, options, {
      type: "tool_call",
      tool: args.tool,
      callId: args.callId,
      input: args.input,
      status: args.status,
    });
  },
  tool_started(ctx: NormalizerContext, options: NormalizerOptions, args: {
    toolName: string;
    preview?: unknown;
  }): ProviderRunEvent {
    return stamp(ctx, options, {
      type: "tool_started",
      toolName: args.toolName,
      preview: args.preview,
    });
  },
  tool_completed(ctx: NormalizerContext, options: NormalizerOptions, args: {
    toolName?: string;
  }): ProviderRunEvent {
    return stamp(ctx, options, {
      type: "tool_completed",
      toolName: args.toolName,
    });
  },
  tool_result(ctx: NormalizerContext, options: NormalizerOptions, args: {
    tool?: string;
    callId?: string;
    result: unknown;
  }): ProviderRunEvent {
    return stamp(ctx, options, {
      type: "tool_result",
      tool: args.tool,
      callId: args.callId,
      result: args.result,
    });
  },
  reasoning_delta(ctx: NormalizerContext, options: NormalizerOptions, args: {
    text: string;
  }): ProviderRunEvent {
    return stamp(ctx, options, { type: "reasoning_delta", text: args.text });
  },
  run_completed(ctx: NormalizerContext, options: NormalizerOptions, args: {
    run: ProviderRunRef;
    outputText?: string;
    output?: { text?: string };
    usage?: ProviderUsage;
  }): ProviderRunEvent {
    return stamp(ctx, options, {
      type: "run_completed",
      run: { ...args.run, status: "completed" },
      outputText: args.outputText,
      output: args.output,
      usage: args.usage,
    });
  },
  run_failed(ctx: NormalizerContext, options: NormalizerOptions, args: {
    run?: ProviderRunRef;
    error: string;
  }): ProviderRunEvent {
    return stamp(ctx, options, {
      type: "run_failed",
      run: args.run ? { ...args.run, status: "failed" } : undefined,
      error: args.error,
    });
  },
  run_cancelled(ctx: NormalizerContext, options: NormalizerOptions, args: {
    run?: ProviderRunRef;
  }): ProviderRunEvent {
    return stamp(ctx, options, { type: "run_cancelled", run: args.run ? { ...args.run, status: "cancelled" } : undefined });
  },
  raw_event(ctx: NormalizerContext, options: NormalizerOptions, args: {
    rawEventType?: string;
    raw: unknown;
  }): ProviderRunEvent {
    return stamp(ctx, options, {
      type: "raw_event",
      rawEventType: args.rawEventType,
      raw: args.raw,
    });
  },
};

export type BuilderName = keyof typeof builders;
type BuilderArg<N extends BuilderName> = Parameters<(typeof builders)[N]>[2];

export function buildEvent<N extends BuilderName>(
  ctx: NormalizerContext,
  options: NormalizerOptions,
  call: { type: N } & BuilderArg<N>,
): ProviderRunEvent {
  const { type, ...rest } = call as { type: N } & Record<string, unknown>;
  return (builders[type] as (
    ctx: NormalizerContext,
    options: NormalizerOptions,
    args: Record<string, unknown>,
  ) => ProviderRunEvent)(ctx, options, rest);
}

export function buildRawEvent(
  ctx: NormalizerContext,
  options: NormalizerOptions,
  raw: unknown,
  rawEventType: string | undefined,
): ProviderRunEvent {
  return builders.raw_event(ctx, options, { rawEventType, raw });
}

export function stamp(
  ctx: NormalizerContext,
  options: NormalizerOptions,
  event: ProviderRunEvent,
): ProviderRunEvent {
  const stamped: ProviderRunEvent = {
    ...event,
    provider: options.provider ?? "claude_code",
    runId: options.baseRef?.runId,
    sequence: ctx.sequence++,
  };
  const parsed = providerRunEventSchema.safeParse(stamped);
  if (parsed.success) return parsed.data;
  return {
    type: "raw_event",
    provider: stamped.provider,
    runId: stamped.runId,
    sequence: stamped.sequence,
    rawEventType: String((stamped as { type: unknown }).type),
    raw: { original: stamped, validationIssues: parsed.error.issues },
  };
}

export function buildBaseRef(
  rec: Record<string, unknown>,
  options: NormalizerOptions,
): ProviderRunRef {
  if (options.baseRef) return options.baseRef;
  const sessionId =
    typeof rec.session_id === "string" ? rec.session_id : crypto.randomUUID();
  return {
    provider: options.provider ?? "claude_code",
    runId: sessionId,
    nativeRunId: sessionId,
    providerRunId: sessionId,
    sessionId,
    status: "running",
    startedAt: new Date().toISOString(),
    stream: { supported: true, reconnectable: true },
  };
}

export function normalizeUsage(raw: unknown): ProviderUsage | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const u = raw as Record<string, unknown>;
  const out: ProviderUsage = {};
  if (typeof u.input_tokens === "number") out.inputTokens = u.input_tokens;
  if (typeof u.output_tokens === "number") out.outputTokens = u.output_tokens;
  if (typeof u.total_tokens === "number") out.totalTokens = u.total_tokens;
  return Object.keys(out).length > 0 ? out : undefined;
}
