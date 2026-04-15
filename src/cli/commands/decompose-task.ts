/**
 * CLI command: decompose-task
 * Decompose a task into subtasks using AI analysis.
 */

import type { Command } from "commander";
import type { ApiClient } from "../lib/api-client.js";
import { formatJson, printError, type OutputFormat } from "../lib/output-formatter.js";
import chalk from "chalk";

export function registerDecomposeTask(
  program: Command,
  getClient: () => ApiClient,
) {
  program
    .command("decompose-task")
    .description("Decompose a task into subtasks using AI analysis")
    .requiredOption("-t, --task-id <id>", "Task ID to decompose")
    .option("-o, --output <format>", "Output format: json or table", "json")
    .action(async (options: { taskId: string; output: OutputFormat }) => {
      try {
        const client = getClient();
        const result = await client.decomposeTask(options.taskId);
        console.log(formatDecomposition(result, options.output));
      } catch (error) {
        printError(error instanceof Error ? error.message : String(error));
      }
    });
}

function formatDecomposition(data: unknown, format: OutputFormat): string {
  if (format === "json") {
    return formatJson(data);
  }

  const result = data as {
    subtasks: Array<{
      title: string;
      description?: string;
      estimatedMinutes: number;
      priority: string;
      order: number;
      dependsOnPrevious: boolean;
    }>;
    totalEstimatedMinutes: number;
    feasibilityScore: number;
    warnings: string[];
  };

  const lines: string[] = [];

  // Header
  const scoreColor =
    result.feasibilityScore >= 70 ? chalk.green :
    result.feasibilityScore >= 40 ? chalk.yellow :
    chalk.red;
  lines.push(chalk.bold.underline("Task Decomposition"));
  lines.push(
    `  Feasibility: ${scoreColor(String(result.feasibilityScore) + "/100")}  ` +
    `Total estimate: ${chalk.cyan(String(result.totalEstimatedMinutes) + " min")}  ` +
    `Subtasks: ${chalk.yellow(String(result.subtasks.length))}`,
  );
  lines.push("");

  // Subtasks
  if (result.subtasks.length > 0) {
    lines.push(chalk.bold("Subtasks:"));
    for (const sub of result.subtasks) {
      const depIndicator = sub.dependsOnPrevious ? chalk.dim(" ↳ (sequential)") : "";
      const priorityColor =
        sub.priority === "High" || sub.priority === "Urgent" ? chalk.red :
        sub.priority === "Medium" ? chalk.yellow :
        chalk.green;
      lines.push(
        `  ${chalk.dim(String(sub.order) + ".")} ${sub.title}  ` +
        `${chalk.cyan(String(sub.estimatedMinutes) + "min")} ` +
        `${priorityColor(sub.priority)}${depIndicator}`,
      );
      if (sub.description) {
        lines.push(`     ${chalk.dim(sub.description.slice(0, 80))}`);
      }
    }
    lines.push("");
  }

  // Warnings
  if (result.warnings.length > 0) {
    lines.push(chalk.bold.yellow("Warnings:"));
    for (const w of result.warnings) {
      lines.push(`  ${chalk.yellow("⚠")} ${w}`);
    }
  }

  return lines.join("\n");
}
