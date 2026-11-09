import { randomUUID } from "node:crypto";
import { processCapability } from "@chrona/process";
import { launchPiProcess } from "@chrona/pi";
import { receiptSchema, startRemotePi, type ModelInput } from "@chrona/remote-model";
import { localPi, type DeviceConfig } from "./config";
import { controlSchema, type Delivery } from "./protocol";
import { Questions, type QuestionView } from "./questions";

export const MODEL_GATEWAY_GAP = "Governed Pi launch is unavailable: configure a reviewed Pi 1.5.0 executable and deploy device/v1/model bound to trusted kernel execution.model reservations. No owner/provider keys or device self-reported model budget may replace this gateway; no process was launched.";
export interface ProcessHandle {
  identity: { id: string; scope: string };
  closed: Promise<{ code: number | null; signal: string | null; outcome?: "finished" | "failed" | "cancelled" | "timed_out" | "unavailable"; error?: string }>;
  stop(): void;
  write(text: string): void | Promise<void>;
}
export interface LaunchDriver {
  availability(delivery: Delivery): { available: false; reason: string } | { available: true };
  launch(input: { delivery: Delivery; cwd: string; onText: (text: string) => void; onQuestion?: (view: QuestionView) => void; model: (key: string, input: ModelInput) => Promise<unknown> }): ProcessHandle;
}
/** Default composition has no configured Pi command; never use host credentials. */
export const governedPiDriver: LaunchDriver = {
  availability: () => ({ available: false, reason: MODEL_GATEWAY_GAP }),
  launch: () => { throw new Error(MODEL_GATEWAY_GAP); },
};

/** The executable and gateway are trusted local composition, never packet input.
 * All model traffic uses the exact journal-bound callback supplied by RemoteDevice.
 */
export function kernelPiDriver(input: { pi: DeviceConfig["pi"]; helperPath: string; chronaExtension: string; profileRoot: string }): LaunchDriver {
  return {
    availability() {
      if (!input.pi) return { available: false, reason: MODEL_GATEWAY_GAP };
      try {
        localPi(input.pi);
        const capability = processCapability({ helperPath: input.helperPath });
        if (process.platform !== "linux" || !capability.available || capability.scope !== "descendants") return { available: false, reason: "Verified Linux descendant supervision is required for governed Pi" };
        return { available: true };
      } catch { return { available: false, reason: "Configured Pi 1.5.0 executable is unavailable or writable by another user" }; }
    },
    launch({ delivery, cwd, onText, onQuestion, model }) {
      if (!input.pi) throw new Error(MODEL_GATEWAY_GAP);
      const { launch } = delivery.packet;
      let unavailable = false;
      const questions = new Questions(Date.parse(launch.deadlineAt), view => { if (!onQuestion) throw new Error("Durable question delivery is unavailable"); onQuestion(view); });
      const { workId, sessionId, runId, attemptId } = launch.fence;
      const handle = startRemotePi({ ...input, ...localPi(input.pi), cwd, goal: launch.goal, execution: { workId, sessionId, runId, attemptId }, deadlineAt: launch.deadlineAt, budget: launch.budget, onText, events: { progress: async () => {}, usage: async () => {}, resources: async () => {}, question: (question, signal) => questions.ask(question, signal) },
        async model(key, request) {
          try {
            const receipt = receiptSchema.parse(await model(key, request));
            if (receipt.status !== "completed") unavailable = true;
            return receipt;
          } catch (error) { unavailable = true; throw error; }
        },
      });
      return { identity: { id: `pi:${randomUUID()}`, scope: "descendants" },
        closed: handle.done.finally(() => questions.close()).then(result => ({ code: result.outcome === "finished" ? 0 : 1, signal: null, outcome: unavailable ? "unavailable" : result.outcome,
          ...(unavailable ? { error: "Trusted kernel execution.model gateway did not return a completed reservation; no provider fallback or automatic replay was attempted" } : {}),
        })),
        stop: () => { void handle.abort().catch(() => {}); }, write: text => {
          const control = controlSchema.parse({ requestKey: "local-validated-control", operation: "control", payload: JSON.parse(text) });
          if (control.operation !== "control") throw new Error("Invalid Pi control");
          if (control.payload.operation === "answer") return questions.answer(control.payload.requestId, control.payload.answer);
          if (control.payload.operation === "write") return handle.inject(control.payload.text);
          throw new Error("Invalid Pi input operation");
        },
      };
    },
  };
}

/** Trusted local composition seam, intentionally absent from the CLI/config.
 * Offline fixtures exercise the actual public Pi native launch adapter. It cannot
 * be selected by any delivery, goal, environment variable or device config.
 * Production uses kernelPiDriver with the trusted model gateway.
 */
export function supervisedProcessDriver(input: { file: string; args: string[]; helperPath: string; env: NodeJS.ProcessEnv }): LaunchDriver {
  return {
    availability() {
      const capability = processCapability({ helperPath: input.helperPath });
      return process.platform === "linux" && capability.available && capability.scope === "descendants" ? { available: true } : { available: false, reason: capability.reason ?? "Only Linux descendant supervision is verified" };
    },
    launch({ delivery, cwd, onText }) {
      const timeoutMs = Math.max(1, Math.min(delivery.packet.launch.budget.timeoutMs, Date.parse(delivery.packet.launch.deadlineAt) - Date.now()));
      const process = launchPiProcess({ file: input.file, args: input.args, cwd, env: input.env, helperPath: input.helperPath, timeoutMs });
      process.stdout.setEncoding("utf8");
      process.stdout.on("data", (text: string) => onText(text));
      // Drain stderr but never forward credentials or unbounded diagnostic text.
      process.stderr.resume();
      process.stdin.on("error", () => {});
      return { identity: { id: `native:${randomUUID()}`, scope: "descendants" }, closed: process.closed, stop: () => process.kill("SIGTERM"), write: text => { if (!process.stdin.write(`${text}\n`)) throw new Error("Process input backpressure; control must not be replayed"); } };
    },
  };
}
