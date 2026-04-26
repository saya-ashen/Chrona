import { Command, Option } from "commander";
import { ApiClient } from "../client.js";
import {
  invalidJson,
  invalidNumber,
  outputResult,
  printErrorAndExit,
  type OutputFormat,
} from "../output/index.js";

export interface CommonCommandOptions {
  output: OutputFormat;
}

export interface ClientOptions {
  baseUrl: string;
}

export type ClientResolver = () => ApiClient;

export function createClientOptions(command: Command): Command {
  return command.addOption(
    new Option("--base-url <url>", "Chrona app API base URL").default("http://localhost:3101"),
  );
}

export function createOutputOption(command: Command): Command {
  return command.addOption(
    new Option("-o, --output <format>", "Output format").choices(["json", "table"]).default("json"),
  );
}

export function createClientResolver(program: Command): ClientResolver {
  return () => {
    const options = program.opts<ClientOptions>();
    return new ApiClient({ baseUrl: options.baseUrl });
  };
}

export async function runCommand(
  action: () => Promise<unknown>,
  options: CommonCommandOptions,
  tableFormatter?: (value: unknown) => string,
): Promise<void> {
  try {
    const result = await action();
    console.log(outputResult(result, options.output, tableFormatter));
  } catch (error) {
    printErrorAndExit(error instanceof Error ? error.message : String(error));
  }
}

export function parseIntegerOption(value: string, label: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    printErrorAndExit(invalidNumber(label, value));
  }
  return parsed;
}

export function parseJsonOption<T>(value: string, label: string): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    printErrorAndExit(invalidJson(label));
  }
}
