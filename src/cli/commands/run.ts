/**
 * CLI command group: run
 *
 * Subcommands:
 *   run start    - Start a run for a task
 *   run message  - Send a message to a running task
 *   run input    - Provide input to a task waiting for input
 */

import { Command } from "commander";
import { ApiClient } from "../lib/api-client.js";
import {
  output,
  formatRunResult,
  printError,
  type OutputFormat,
} from "../lib/output-formatter.js";

export function registerRunCommands(
  program: Command,
  getClient: () => ApiClient,
): void {
  const run = program
    .command("run")
    .description("Run management commands");

  // ── run start ──────────────────────────────────────────────────────
  run
    .command("start")
    .description("Start a run for a task")
    .requiredOption("-t, --task-id <id>", "Task ID")
    .option("--prompt <prompt>", "Override prompt for this run")
    .option("-o, --output <format>", "Output format: json or table", "json")
    .action(async (opts: { taskId: string; prompt?: string; output: string }) => {
      try {
        const client = getClient();
        const data = await client.startRun(opts.taskId, opts.prompt);
        console.log(output(data, opts.output as OutputFormat, formatRunResult));
      } catch (err) {
        printError(err instanceof Error ? err.message : String(err));
      }
    });

  // ── run message ────────────────────────────────────────────────────
  run
    .command("message")
    .description("Send a message to a running task")
    .requiredOption("-t, --task-id <id>", "Task ID")
    .requiredOption("-m, --message <msg>", "Message to send")
    .option("-o, --output <format>", "Output format: json or table", "json")
    .action(async (opts: { taskId: string; message: string; output: string }) => {
      try {
        const client = getClient();
        const data = await client.sendMessage(opts.taskId, opts.message);
        console.log(output(data, opts.output as OutputFormat, formatRunResult));
      } catch (err) {
        printError(err instanceof Error ? err.message : String(err));
      }
    });

  // ── run input ──────────────────────────────────────────────────────
  run
    .command("input")
    .description("Provide input to a task waiting for input")
    .requiredOption("-t, --task-id <id>", "Task ID")
    .requiredOption("--text <input>", "Input text to provide")
    .option("-o, --output <format>", "Output format: json or table", "json")
    .action(async (opts: { taskId: string; text: string; output: string }) => {
      try {
        const client = getClient();
        const data = await client.provideInput(opts.taskId, opts.text);
        console.log(output(data, opts.output as OutputFormat, formatRunResult));
      } catch (err) {
        printError(err instanceof Error ? err.message : String(err));
      }
    });
}
