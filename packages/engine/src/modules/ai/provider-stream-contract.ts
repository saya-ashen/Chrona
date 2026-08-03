import {
  providerRunEventSchema,
  type ProviderRunEvent,
  type ProviderRunRef,
} from "@chrona/providers-foundation";


export class ProviderStreamContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderStreamContractError";
  }
}

export type ProviderStreamEventBoundary = {
  accept(event: unknown): ProviderRunEvent;
  finish(): void;
  pauseAfterToolCall(callId: string): void;
};

/** Enforces identity, ordering, and exactly-one-terminal provider stream semantics. */
export function createProviderStreamEventBoundary(
  expected: Pick<ProviderRunRef, "provider" | "runId" | "sessionId">,
): ProviderStreamEventBoundary {
  let previousSequence = -1;
  let terminalSeen = false;
  let paused = false;

  return {
    // Stream identity, ordering, and terminal-state checks are one atomic boundary.
    // eslint-disable-next-line complexity
    accept(value: unknown): ProviderRunEvent {
      const parsed = providerRunEventSchema.safeParse(value);
      if (!parsed.success) {
        throw new ProviderStreamContractError(
          `Provider stream event failed schema validation: ${parsed.error.issues.map((issue) => issue.message).join("; ")}`,
        );
      }
      const event = parsed.data;
      if (
        event.provider !== expected.provider ||
        event.runId !== expected.runId ||
        event.sessionId !== expected.sessionId
      ) {
        throw new ProviderStreamContractError(
          `Provider stream event identity does not match ${expected.provider}/${expected.runId}/${expected.sessionId}`,
        );
      }
      if (event.sequence === undefined || event.sequence <= previousSequence) {
        throw new ProviderStreamContractError(
          `Provider stream event sequence must strictly increase (received ${String(event.sequence)} after ${previousSequence})`,
        );
      }
      if (terminalSeen) {
        throw new ProviderStreamContractError("Provider stream emitted an event after its terminal event");
      }
      previousSequence = event.sequence;

      if (
        event.type === "run_completed" ||
        event.type === "run_failed" ||
        event.type === "run_cancelled"
      ) {
        const run = event.run;
        if (
          !run ||
          run.provider !== expected.provider ||
          run.runId !== expected.runId ||
          run.sessionId !== expected.sessionId
        ) {
          throw new ProviderStreamContractError(
            `Provider stream terminal event identity does not match ${expected.provider}/${expected.runId}/${expected.sessionId}`,
          );
        }
        terminalSeen = true;
      }
      return event;
    },

    finish(): void {
      if (!terminalSeen && !paused) {
        throw new ProviderStreamContractError("Provider stream ended without exactly one terminal event");
      }
    },

    pauseAfterToolCall(callId: string): void {
      if (terminalSeen || previousSequence < 0 || !callId) throw new ProviderStreamContractError("Provider stream cannot pause before a valid action request");
      paused = true;
    },
  };
}
