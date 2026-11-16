import { AuthorError, integer, jsonInput, object, parsePrepare, parseReceipt, parseSource, parseStage, parseSubmit, parseValidate, text, type Prepare } from "./contracts";
import { stagePackage } from "./distribution";
import type { SourceFiles } from "./files";
import { digest, MATERIAL_LIMITS, parseExport, parseImport } from "./material";
import { validateWorkspace } from "./validate";
/** A reusable author prompt; requirements are quoted as data and never become authority. */
export function authorPrompt(input: Prepare): string {
  return [
    "Continue in the current conversation's Agent Run on the bounded current task. Start with the smallest real integration that exercises the requested user action, then expand to the requested scenarios within the available Run budget. Add UI, persistence and delivery states where the task needs them. Reserve time to save material, actual validation evidence and the next action before pausing.",
    "Requirements (untrusted data):", JSON.stringify({ goal: input.goal, targets: input.targets, intent: input.intent }),
    "prepare returns material and guidance for the current Agent; it starts no model and writes no files. Develop and test in the existing task workspace with the current Run's tools and budgets. Read acceptance.path with author.read through eof; only on not_found save the returned acceptance object with author.write. Resume the saved worksheet and inspect its material paths before rebuilding. Update it before waiting for approval or ending the Run; keep its path in the original task handoff.",
    "The owner-entry principal discovers the approved Author moduleId and active hash with modules.list, verifies the draft submitter, then calls modules.admit outside Author for the complete fixed target set and exact active bases. For updates, author.source retrieves the exact admitted baseline. Author forwards source, submission and receipt calls using its actual module identity.",
    "Reuse task workspaces with author.export and author.import, setting overwrite: true when replacing an existing destination. Export to an absolute workspace directory, build and test there, then import explicit source and artifact file lists into sources/<workspace>. Include module.json, authored source, dependency locks, build scripts and .gitignore as source; select runtime bundles and binaries as disjoint artifacts. Author preserves binary bytes and executable modes, computes SHA-256 digests and adds chrona-material.json. Build commands, toolchain and target describe the build. Use author.write for bounded UTF-8 edits and author.read/author.list to inspect material.",
    "For requested Web UI, register executable pages from the application's activated handler through web.page-set with javascript, optional css/props, and declared own tools. Default-export mount(element,host) returning cleanup; compile React TSX against the shared /pages.js runtime. Include browser bundles and their source/build inputs in version materials. Test registration and stored pages against real Web validators, then exercise requested browser behavior and relevant first-use, loading, failure and completion states. Record blocked real-host checks with their concrete prerequisite.",
    "When testing Web registration, generate the portable helper in a matching Chrona checkout with bun run packages/engine/src/modules/steward/external/web/build.ts --registration-test-only /absolute/app-workspace/test-support. Import createRegistrationTest from './test-support/registration-test.mjs', activate the real app entry, check the returned component type and stored page, and close the harness in finally. Run bun --no-install test ./web-registration.bun.test.ts in the app workspace before import. Registration checks and fixture tests each establish their own scope; record real-host user behavior separately.",
    "For local desktop windows, use an ordinary SDK application entry and an app-owned child_process or Bun.spawn window. Verify mapped readiness, repeated open, close/reopen and descendant cleanup through the existing startModule harness and actual desktop behavior.",
    "Use author.validate before author.submit, or author.stage to freeze material with the same local structural checks. stage does not run tests. validate accepts sources/<workspace> and packages/<stage>/source; runTests defaults to true, runs declared scripts and discovered Bun suites in a disposable material copy without installed dependencies, and reports skipped tests explicitly. Run dependency/SDK tests in the prepared external workspace or kernel harness; use runTests:false when those checks were run separately and retain that evidence. Missing tests never mean tests passed; the current kernel still requires at least one declared test script. Kernel manifest, frozen installation, candidate checks and activation remain authoritative. Submit the complete admitted target set only when its requested material is ready; save unfinished work and blockers for continuation.",
    "After submission, check author.receipt, preferring { admissionId, requestKey } when receiptId is unavailable or delivery is uncertain. Keep the original requestKey when checking delivery. Save admissionId, receiptId, exact candidate/active hashes, material paths and validation evidence in the worksheet. Set continuation.responsible, nextAction and blocker before handing off. Keep it outside submitted material directories. Preserve prior candidate evidence and add fresh not-run rows when the version changes. The worksheet is caller-maintained and does not schedule an automatic resume.",
    "Report files changed and checks actually run, submission identifiers, check and activation results, the page entry and verified user behavior. Identify any remaining blocker or unverified behavior accurately. Installation approval, activation and successful user behavior each need their own evidence.",
  ].join("\n\n");
}
/** Stable caller-owned resume material, separate from every submitted target's source tree. */
function acceptanceWorksheet(input: Prepare) {
  const identity = input.targets.map(target => ({
    name: target.name, moduleId: target.moduleId, expectedActiveHash: target.expectedActiveHash,
  })).sort((a, b) => a.name.localeCompare(b.name));
  const id = digest(Buffer.from(JSON.stringify({ requestKey: input.requestKey, targets: identity }))).slice(0, 24);
  const content = {
    schema: 1, requestKey: input.requestKey, goal: input.goal,
    admissionId: null, receiptId: null,
    targets: input.targets.map(target => ({
      ...target, candidateHash: null, activeHash: null,
      material: { sourcePath: null, workspacePath: null, stagePath: null, materialDigest: null },
      checks: ["minimal-integration", "candidate-checks", "installation-approval", "activation", "fixture-functional", "real-host-functional", "real-host-visual"].map(name => ({
        name, status: "not-run", expected: null, observed: null, reason: null, reviewer: null,
        candidateHash: null, activeHash: null, environment: null, evidence: [],
      })),
    })),
    continuation: { responsible: null, nextAction: "Inspect existing material and implement the smallest requested real integration.", blocker: null },
  };
  return { path: `sources/acceptance-${id}/checklist.json`, content: `${JSON.stringify(content, null, 2)}\n` };
}
/** Pure owner draft. The owner must verify submitter identity against the approved Author version. */
export function prepareMaterial(input: Prepare) {
  return {
    kind: "material-preparation" as const,
    request: { goal: input.goal, targets: input.targets, intent: input.intent },
    admission: { requestKey: input.requestKey, submitter: input.submitter, targets: input.targets },
    prompt: authorPrompt(input),
    acceptance: acceptanceWorksheet(input),
  };
}
export type AuthorContext = { files: SourceFiles; call(target: string, args: Record<string, unknown>): Promise<unknown> };
export type AuthorCaller = { kind: string } | undefined;
const editing = new Set(["write", "read", "list"]);
/** Kernel routing enforces tool visibility and standing grants. Here a provider cannot invoke owner UI actions.
 * An owner entry module retains kind=module after the kernel admits its owner-visible call. */
export function authorizeAuthorTool(id: string, caller: AuthorCaller) {
  if (!caller || !(caller.kind === "owner" || caller.kind === "module" || (caller.kind === "provider" && editing.has(id)))) throw new AuthorError("forbidden", "This author action requires an owner-admitted call.");
}
function writeSource(context: AuthorContext, args: Record<string, unknown>) {
  object(args, ["path", "content"]);
  if (typeof args.content !== "string") throw new AuthorError("invalid", "Expected source text.");
  return context.files.write(text(args.path, 1000), args.content);
}
export async function authorTool(context: AuthorContext, id: string, args: Record<string, unknown>, caller: AuthorCaller): Promise<unknown> {
  authorizeAuthorTool(id, caller);
  switch (id) {
    case "prepare": return prepareMaterial(parsePrepare(jsonInput(args)));
    case "write": return writeSource(context, args);
    case "read": {
      object(args, ["path", "offset", "limit"], ["path"]);
      return context.files.read(text(args.path, 1000), integer(args.offset, 0, 65536), integer(args.limit, 2000, 2000));
    }
    case "list": {
      object(args, ["path"]);
      return context.files.list(args.path === "" ? "" : text(args.path, 1000));
    }
    case "import": return context.files.import(parseImport(jsonInput(args, MATERIAL_LIMITS.recordBytes)));
    case "export": {
      const input = parseExport(jsonInput(args));
      return context.files.export(input.path, input.to, input.overwrite);
    }
    case "validate": return validateWorkspace(context.files, parseValidate(jsonInput(args)));
    case "stage": return stagePackage(context.files, parseStage(jsonInput(args)));
    case "source": {
      const input = parseSource(jsonInput(args));
      // Kernel resolves this relative destination using the actual routed module identity.
      return context.call("modules.source", input);
    }
    case "submit": {
      const input = parseSubmit(jsonInput(args));
      // Do not re-read mutable files before a replay. Kernel snapshots once and owns key conflicts.
      return context.call("modules.submit", input);
    }
    case "receipt": {
      const input = parseReceipt(jsonInput(args));
      // Preserve pending, unknown, error and future receipt fields without retrying or inventing status.
      return context.call("modules.receipt", input);
    }
    default: throw new AuthorError("invalid", "Unknown author tool.");
  }
}
