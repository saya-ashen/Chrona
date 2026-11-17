import { verify } from "node:crypto";
import { cleanupLocalWorkspace } from "@chrona/git-workspaces";
import { executionDeliveryFinalSchema, executionSignedStopSchema, kernelCleanupReceiptSchema, type KernelCleanupInput } from "@chrona/contracts/steward";
import type { DeviceConfig } from "./config";
import type { Attempt, Journal } from "./journal";
import { executionDigest } from "./protocol";
import { workspaceInput } from "./workspace";

/** Local stop facts supplement the public library's ownership, physical locks,
 * clean Git tree and explicit preview checks. Only the trusted kernel can admit
 * the command or verify remote stop evidence; an app custody ACK is not proof. */
function stoppedFacts(journal: Journal, config: DeviceConfig, attempt: Attempt) {
  const current = journal.get(attempt.delivery.deliveryId);
  if (current?.state !== "stopped") throw new Error("Workspace stop is unknown");
  const held = journal.db.query<{ n: number }, [string]>("SELECT COUNT(*) AS n FROM capacity WHERE identity=?").get(attempt.delivery.packet.launch.target.directoryIdentity)!.n;
  if (held) throw new Error("Stable target is held");
  const rows = journal.db.query<{ envelope: string }, [string]>("SELECT envelope FROM outbox WHERE delivery_id=? AND (report_key='final' OR report_key LIKE 'stop:%') ORDER BY id").all(attempt.delivery.deliveryId).map(row => JSON.parse(row.envelope));
  const final = executionDeliveryFinalSchema.parse(rows.find(row => row.kind === "final")?.payload);
  const proof = executionSignedStopSchema.parse(rows.find(row => row.kind === "stop")?.payload);
  if (executionDigest(proof.statement.target) !== executionDigest(attempt.delivery.packet.target) || proof.statement.finalDigest !== executionDigest(final) || proof.statement.sourceThrough !== current.sourceWatermark || executionDigest(proof.statement.processIdentity) !== executionDigest(current.processIdentity) || !verify(null, Buffer.from(executionDigest(proof.statement), "hex"), config.publicKey, Buffer.from(proof.signature, "base64"))) throw new Error("Cleanup stop evidence mismatch");
  return executionDigest({ target: attempt.delivery.packet.target, final, proof, input: workspaceInput(journal.root, config, attempt) });
}
export async function executeCleanup(root: string, config: DeviceConfig, journal: Journal, attempt: Attempt, command: KernelCleanupInput) {
  const saved = journal.cleanupRequest(attempt.delivery.deliveryId, command);
  if (saved.receipt) return saved.receipt;
  const receipt = (state: "unknown" | "blocked", reason: string) => ({ workId: command.workId, workspaceRef: attempt.delivery.packet.launch.workspaceRef, state, reason, previewDigest: command.op === "confirm" ? command.previewDigest : null });
  // A crash between this FULL commit and the public operation has an unknown
  // effect. Never repeat a destructive command to discover what happened.
  let result: unknown = receipt("unknown", "Original cleanup outcome is unknown; command was not replayed");
  if (saved.created) {
    let invoked = false;
    try {
      stoppedFacts(journal, config, attempt);
      const input = workspaceInput(root, config, attempt);
      invoked = true;
      result = await cleanupLocalWorkspace(input, command.op === "preview" ? { action: "preview", workId: command.workId, commandKey: command.commandKey } : { action: "confirm", workId: command.workId, commandKey: command.commandKey, previewDigest: command.previewDigest }, async () => stoppedFacts(journal, config, attempt));
      // The native confirm receipt must preserve the admitted preview digest,
      // including a blocked safety check; it must never imply removal occurred.
      if (command.op === "confirm") result = { ...kernelCleanupReceiptSchema.parse(result), previewDigest: command.previewDigest };
    } catch { result = invoked ? receipt("unknown", "Cleanup operation outcome could not be confirmed; no replay is permitted") : receipt("blocked", "Workspace cleanup stop, mapping or ownership checks failed"); }
  }
  const parsed = kernelCleanupReceiptSchema.parse(result);
  journal.cleanupReceipt(attempt.delivery.deliveryId, command, parsed);
  return parsed;
}
