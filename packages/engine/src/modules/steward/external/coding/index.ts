import { applicationCall, applicationCallStatus } from "./client";
import { on, onDisconnect, chrona } from "chrona";
import { codingError, type CodingContext } from "./storage";
import { handleCodingCommand } from "./service";
import { handleCodingHttp } from "./http";
import { startCodingEvidenceObserver } from "./evidence-observer";

const context: CodingContext = {
  dir: chrona.paths.data, content: chrona.paths.content,
  call: applicationCall, callStatus: applicationCallStatus,
};
onDisconnect(startCodingEvidenceObserver(context));
on("tool", async event => {
  // Routing enforces the caller's approved owner authority before this handler.
  if (!["owner", "module"].includes(event.caller?.kind ?? "")) throw codingError("forbidden", "Coding commands require an admitted owner or application");
  if (event.id !== "command" || Object.keys(event.args).length !== 1 || typeof event.args.input !== "string") throw codingError("invalid", "Expected Coding command JSON in input");
  if (Buffer.byteLength(event.args.input) > 32 * 1024) throw codingError("too_large", "Coding command exceeds 32 KiB");
  let raw: unknown;
  try { raw = JSON.parse(event.args.input); } catch { throw codingError("invalid", "Expected Coding command JSON"); }
  return { result: await handleCodingCommand(context, raw) };
});
// SDK HTTP listeners use chrona.serve; there is no http event in the SDK event union.
chrona.serve(request => handleCodingHttp(request, raw => handleCodingCommand(context, raw)), { idleTimeout: 30 });
