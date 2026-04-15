/**
 * CLI command: suggest-timeslot
 * Get suggested time slots for scheduling a task.
 */

import type { Command } from "commander";
import type { ApiClient } from "../lib/api-client.js";
import { formatJson, printError, type OutputFormat } from "../lib/output-formatter.js";
import chalk from "chalk";

export function registerSuggestTimeslot(
  program: Command,
  getClient: () => ApiClient,
) {
  program
    .command("suggest-timeslot")
    .description("Get suggested time slots for scheduling a task")
    .requiredOption("-w, --workspace-id <id>", "Workspace ID")
    .requiredOption("-t, --task-id <id>", "Task ID")
    .option("-d, --date <date>", "Date to suggest slots for (YYYY-MM-DD); defaults to today")
    .option("-o, --output <format>", "Output format: json or table", "json")
    .action(async (options: { workspaceId: string; taskId: string; date?: string; output: OutputFormat }) => {
      try {
        const client = getClient();
        const result = await client.suggestTimeslot(options.workspaceId, options.taskId, options.date);
        console.log(formatTimeslots(result, options.output));
      } catch (error) {
        printError(error instanceof Error ? error.message : String(error));
      }
    });
}

function formatTimeslots(data: unknown, format: OutputFormat): string {
  if (format === "json") {
    return formatJson(data);
  }

  const result = data as {
    suggestions: Array<{
      startAt: string;
      endAt: string;
      score: number;
      reasons: string[];
      conflicts: string[];
    }>;
    bestMatch: {
      startAt: string;
      endAt: string;
      score: number;
      reasons: string[];
      conflicts: string[];
    } | null;
  };

  const lines: string[] = [];

  lines.push(chalk.bold.underline("Suggested Time Slots"));
  lines.push(`  Total suggestions: ${chalk.cyan(String(result.suggestions.length))}`);
  lines.push("");

  if (result.bestMatch) {
    lines.push(chalk.bold.green("★ Best Match:"));
    lines.push(formatSlot(result.bestMatch, true));
    lines.push("");
  }

  if (result.suggestions.length > 0) {
    lines.push(chalk.bold("All Suggestions:"));
    for (let index = 0; index < result.suggestions.length; index++) {
      const slot = result.suggestions[index];
      const isBest = result.bestMatch &&
        slot.startAt === result.bestMatch.startAt &&
        slot.endAt === result.bestMatch.endAt;
      lines.push(`  ${chalk.dim(String(index + 1) + ".")} ${formatSlot(slot, !!isBest)}`);
    }
  } else {
    lines.push(chalk.dim("  No suitable time slots found."));
  }

  return lines.join("\n");
}

function formatSlot(slot: { startAt: string; endAt: string; score: number; reasons: string[]; conflicts: string[] }, isBest: boolean): string {
  const start = new Date(slot.startAt);
  const end = new Date(slot.endAt);
  const timeStr = `${pad(start.getUTCHours())}:${pad(start.getUTCMinutes())} – ${pad(end.getUTCHours())}:${pad(end.getUTCMinutes())}`;

  const scoreColor =
    slot.score >= 70 ? chalk.green :
    slot.score >= 50 ? chalk.yellow :
    chalk.red;

  const parts = [
    isBest ? chalk.green(timeStr) : timeStr,
    scoreColor(`(${slot.score}/100)`),
  ];

  if (slot.reasons.length > 0) {
    parts.push(chalk.dim(slot.reasons.slice(0, 2).join(", ")));
  }
  if (slot.conflicts.length > 0) {
    parts.push(chalk.red(`⚠ ${slot.conflicts.join(", ")}`));
  }

  return parts.join("  ");
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}
