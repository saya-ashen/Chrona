import { readFileSync } from "node:fs";
import type { AgentControlActionBody } from "@chrona/contracts";

export interface ParseResult {
  body: AgentControlActionBody;
}

export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

type JsonObject = Record<string, unknown>;

function takeOption(args: string[], name: string) {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new UsageError(`${name} requires a value`);
  }
  args.splice(index, 2);
  return value;
}

function ensureNoExtra(args: string[]) {
  if (args.length > 0) {
    throw new UsageError(`Unknown argument: ${args[0]}`);
  }
}

function parseJson(value: string, label: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch (error) {
    const suffix = error instanceof Error ? `: ${error.message}` : "";
    throw new UsageError(`${label} must be valid JSON${suffix}`);
  }
}

function readJsonFile(path: string, label: string): unknown {
  return parseJson(readFileSync(path, "utf8"), label);
}

function requireString(value: string | undefined, name: string) {
  if (!value) {
    throw new UsageError(`${name} is required`);
  }
  return value;
}

function optionalObject(value: unknown, label: string): JsonObject | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new UsageError(`${label} must be a JSON object`);
  }
  return value as JsonObject;
}

function specFromFile(path: string | undefined, label: string) {
  return readJsonFile(requireString(path, label), label);
}

function outputsFromFile(path: string | undefined, label: string) {
  if (!path) return undefined;
  const parsed = readJsonFile(path, label);
  return Array.isArray(parsed) ? parsed : [parsed];
}


export function buildControlPayload(argv: string[]): ParseResult {
  const [domain, command, ...rest] = argv;
  const args = [...rest];

  if (domain === "task" && command === "read") {
    ensureNoExtra(args);
    return { body: { kind: "task_read", payload: {} } };
  }

  if (domain === "plan" && command === "read") {
    ensureNoExtra(args);
    return { body: { kind: "plan_read", payload: {} } };
  }

  if (domain !== "node") {
    throw new UsageError("Expected command: node|task|plan");
  }

  switch (command) {
    case "output": {
      const outputsFile = takeOption(args, "--outputs-file") ?? takeOption(args, "--output-file");
      const mode = takeOption(args, "--mode");
      const summary = takeOption(args, "--summary");
      ensureNoExtra(args);
      if (mode !== undefined && mode !== "append" && mode !== "replace") {
        throw new UsageError("--mode must be append or replace");
      }
      return {
        body: {
          kind: "output",
          payload: {
            spec: specFromFile(outputsFile, "--outputs-file") as never,
            ...(mode ? { mode } : {}),
            ...(summary ? { summary } : {}),
          },
        },
      };
    }
    case "complete": {
      const outputFile = takeOption(args, "--output-file");
      const summary = takeOption(args, "--summary");
      ensureNoExtra(args);
      return {
        body: {
          kind: "complete",
          payload: {
            ...(summary ? { summary } : {}),
            ...(outputFile ? { outputs: outputsFromFile(outputFile, "--output-file") as never[] } : {}),
          },
        },
      };
    }
    case "condition-select": {
      const branchRef = takeOption(args, "--branch") ?? takeOption(args, "--branch-ref");
      const summary = takeOption(args, "--summary");
      const outputFile = takeOption(args, "--output-file");
      const nodeId = takeOption(args, "--node-id") ?? "current";
      ensureNoExtra(args);
      return {
        body: {
          kind: "condition_select",
          payload: {
            nodeId,
            branchRef: requireString(branchRef, "--branch"),
            summary: requireString(summary, "--summary"),
            ...(outputFile ? { outputs: outputsFromFile(outputFile, "--output-file") as never[] } : {}),
          },
        },
      };
    }
    case "wait-complete": {
      const summary = takeOption(args, "--summary");
      const outputFile = takeOption(args, "--output-file");
      ensureNoExtra(args);
      return {
        body: {
          kind: "wait_complete",
          payload: {
            summary: requireString(summary, "--summary"),
            ...(outputFile ? { outputs: outputsFromFile(outputFile, "--output-file") as never[] } : {}),
          },
        },
      };
    }
    case "block": {
      const reason = takeOption(args, "--reason");
      const actionFormRaw = takeOption(args, "--action-form");
      const actionFormFile = takeOption(args, "--action-form-file");
      const retryable = takeOption(args, "--retryable");
      ensureNoExtra(args);
      const actionForm = actionFormRaw
        ? parseJson(actionFormRaw, "--action-form")
        : actionFormFile
          ? readJsonFile(actionFormFile, "--action-form-file")
          : undefined;
      return {
        body: {
          kind: "block",
          payload: {
            reason: requireString(reason, "--reason"),
            actionForm: optionalObject(actionForm, "actionForm") as never,
            ...(retryable === undefined ? {} : { retryable: retryable === "true" }),
          },
        },
      };
    }
    case "fail": {
      const error = takeOption(args, "--error");
      const diagnosticsRaw = takeOption(args, "--diagnostics");
      const diagnosticsFile = takeOption(args, "--diagnostics-file");
      const retryable = takeOption(args, "--retryable");
      ensureNoExtra(args);
      return {
        body: {
          kind: "fail",
          payload: {
            error: requireString(error, "--error"),
            ...(retryable === undefined ? {} : { retryable: retryable === "true" }),
            ...(diagnosticsRaw ? { diagnostics: parseJson(diagnosticsRaw, "--diagnostics") } : {}),
            ...(diagnosticsFile ? { diagnostics: readJsonFile(diagnosticsFile, "--diagnostics-file") } : {}),
          },
        },
      };
    }
    default:
      throw new UsageError(`Unknown node command: ${command ?? ""}`);
  }
}
