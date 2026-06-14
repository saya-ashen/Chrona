#!/usr/bin/env bun
import { sendControlAction, type FetchLike } from "./client";
import { buildControlPayload, UsageError } from "./payloads";

export interface MainOptions {
  argv?: string[];
  env?: Record<string, string | undefined>;
  fetchImpl?: FetchLike;
  stdout?: Pick<typeof process.stdout, "write">;
  stderr?: Pick<typeof process.stderr, "write">;
}

export async function run(options: MainOptions = {}) {
  const argv = options.argv ?? process.argv.slice(2);
  const env = options.env ?? process.env;
  const fetchImpl = options.fetchImpl ?? fetch;
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;

  try {
    const { body } = buildControlPayload(argv);
    const result = await sendControlAction(body, { env, fetchImpl });
    stdout.write(`${JSON.stringify(result)}\n`);
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const prefix = error instanceof UsageError ? "Usage error" : "Chrona agent command failed";
    stderr.write(`${prefix}: ${message}\n`);
    return 1;
  }
}

if (import.meta.main) {
  const code = await run();
  process.exit(code);
}
