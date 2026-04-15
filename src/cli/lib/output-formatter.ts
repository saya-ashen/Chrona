/**
 * Output formatting utilities for the AgentDashboard CLI.
 * Supports JSON and table output modes using chalk and cli-table3.
 *
 * Default output is JSON (optimized for AI-agent consumption).
 */

import chalk from "chalk";
import Table = require("cli-table3");

export type OutputFormat = "json" | "table";

// ── Generic Formatters ───────────────────────────────────────────────

/**
 * Pretty-print data as indented JSON.
 */
export function formatJson(data: unknown): string {
  return JSON.stringify(data, null, 2);
}

/**
 * Render a table with headers and rows.
 */
export function formatTable(
  headers: string[],
  rows: (string | number | null | undefined)[][],
): string {
  const table = new Table({
    head: headers.map((h) => chalk.cyan.bold(h)),
    style: { head: [], border: [] },
  });

  for (const row of rows) {
    table.push(row.map((cell) => (cell == null ? chalk.dim("—") : String(cell))));
  }

  return table.toString();
}

/**
 * Universal output: returns JSON or passes to a table formatter callback.
 */
export function output(
  data: unknown,
  format: OutputFormat,
  tableFormatter?: (data: unknown) => string,
): string {
  if (format === "json") {
    return formatJson(data);
  }
  if (tableFormatter) {
    return tableFormatter(data);
  }
  return formatJson(data);
}

// ── Task Formatters ──────────────────────────────────────────────────

/**
 * Format a single task detail for table output.
 */
export function formatTaskDetail(data: unknown): string {
  const t = data as Record<string, unknown>;
  const lines: string[] = [];
  lines.push(chalk.bold.underline("Task Details"));
  lines.push(`  ID:          ${t.id ?? t.taskId ?? "—"}`);
  lines.push(`  Title:       ${t.title ?? "—"}`);
  lines.push(`  Status:      ${t.status ?? "—"}`);
  lines.push(`  Priority:    ${t.priority ?? "—"}`);
  lines.push(`  Description: ${t.description ?? "—"}`);
  lines.push(`  Due:         ${t.dueAt ?? "—"}`);
  lines.push(`  Model:       ${t.runtimeModel ?? "—"}`);
  lines.push(`  Prompt:      ${t.prompt ? String(t.prompt).slice(0, 80) : "—"}`);
  lines.push(`  Scheduled:   ${t.scheduledStartAt ?? "—"} → ${t.scheduledEndAt ?? "—"}`);
  lines.push(`  Created:     ${t.createdAt ?? "—"}`);
  lines.push(`  Updated:     ${t.updatedAt ?? "—"}`);
  return lines.join("\n");
}

/**
 * Format a list of tasks for table output.
 */
export function formatTaskList(data: unknown): string {
  const items = (Array.isArray(data) ? data : (data as { tasks?: unknown[] })?.tasks ?? []) as Record<string, unknown>[];
  if (items.length === 0) {
    return chalk.dim("No tasks found.");
  }
  const rows = items.map((t) => [
    String(t.id ?? t.taskId ?? "").slice(0, 12),
    String(t.title ?? "").slice(0, 40),
    t.status as string | null,
    t.priority as string | null,
    t.dueAt ? String(t.dueAt).slice(0, 10) : null,
    t.scheduledStartAt ? String(t.scheduledStartAt).slice(0, 16) : null,
  ]);
  return formatTable(["ID", "Title", "Status", "Priority", "Due", "Scheduled"], rows);
}

// ── Run Formatters ───────────────────────────────────────────────────

/**
 * Format a run result for table output.
 */
export function formatRunResult(data: unknown): string {
  const r = data as Record<string, unknown>;
  const lines: string[] = [];
  lines.push(chalk.bold.underline("Run Result"));
  for (const [key, val] of Object.entries(r)) {
    lines.push(`  ${key}: ${val == null ? "—" : typeof val === "object" ? JSON.stringify(val) : String(val)}`);
  }
  return lines.join("\n");
}

// ── Conflict Formatters ──────────────────────────────────────────────

/**
 * Format conflict analysis results.
 */
export function formatConflicts(data: unknown): string {
  const result = data as {
    conflicts: Array<{
      id: string;
      type: string;
      severity: string;
      taskIds: string[];
      description: string;
    }>;
    suggestions: Array<{
      id: string;
      type: string;
      description: string;
      reason: string;
      affectedTaskIds: string[];
    }>;
    summary: {
      totalConflicts: number;
      highSeverityCount: number;
      mediumSeverityCount: number;
      lowSeverityCount: number;
      affectedTaskCount: number;
    };
  };

  const lines: string[] = [];

  const s = result.summary;
  lines.push(chalk.bold.underline("Conflict Analysis Summary"));
  lines.push(
    `  Total conflicts: ${chalk.yellow(String(s.totalConflicts))}  ` +
    `(${chalk.red("High:" + s.highSeverityCount)} | ` +
    `${chalk.yellow("Med:" + s.mediumSeverityCount)} | ` +
    `${chalk.green("Low:" + s.lowSeverityCount)})`,
  );
  lines.push(`  Affected tasks:  ${chalk.yellow(String(s.affectedTaskCount))}`);
  lines.push("");

  if (result.conflicts?.length > 0) {
    lines.push(chalk.bold("Conflicts:"));
    const conflictRows = result.conflicts.map((c) => {
      const severityColor =
        c.severity === "high" ? chalk.red :
        c.severity === "medium" ? chalk.yellow :
        chalk.green;
      return [
        c.id.slice(0, 8),
        c.type,
        severityColor(c.severity),
        c.taskIds.join(", ").slice(0, 30),
        c.description.slice(0, 50),
      ];
    });
    lines.push(formatTable(["ID", "Type", "Severity", "Tasks", "Description"], conflictRows));
  }

  if (result.suggestions?.length > 0) {
    lines.push(chalk.bold("Suggestions:"));
    const suggestionRows = result.suggestions.map((sg) => [
      sg.id.slice(0, 8),
      sg.type,
      sg.description.slice(0, 40),
      sg.reason.slice(0, 40),
    ]);
    lines.push(formatTable(["ID", "Type", "Description", "Reason"], suggestionRows));
  }

  return lines.join("\n");
}

// ── Automation Formatters ────────────────────────────────────────────

/**
 * Format automation suggestion results.
 */
export function formatAutomation(data: unknown): string {
  const result = data as {
    executionMode: string;
    reminderStrategy: {
      advanceMinutes: number;
      frequency: string;
      channels: string[];
    };
    preparationSteps: string[];
    contextSources: Array<{ type: string; description: string }>;
    confidence: string;
  };

  const lines: string[] = [];
  const confidenceColor =
    result.confidence === "high" ? chalk.green :
    result.confidence === "medium" ? chalk.yellow :
    chalk.red;

  lines.push(chalk.bold.underline("Automation Suggestion"));
  lines.push(`  Execution mode: ${chalk.cyan(result.executionMode)}`);
  lines.push(`  Confidence:     ${confidenceColor(result.confidence)}`);
  lines.push("");

  lines.push(chalk.bold("Reminder Strategy:"));
  lines.push(`  Advance:   ${result.reminderStrategy.advanceMinutes} minutes`);
  lines.push(`  Frequency: ${result.reminderStrategy.frequency}`);
  lines.push(`  Channels:  ${result.reminderStrategy.channels.join(", ")}`);
  lines.push("");

  if (result.preparationSteps?.length > 0) {
    lines.push(chalk.bold("Preparation Steps:"));
    for (let i = 0; i < result.preparationSteps.length; i++) {
      lines.push(`  ${chalk.dim(String(i + 1) + ".")} ${result.preparationSteps[i]}`);
    }
    lines.push("");
  }

  if (result.contextSources?.length > 0) {
    lines.push(chalk.bold("Context Sources:"));
    lines.push(
      formatTable(
        ["Type", "Description"],
        result.contextSources.map((cs) => [cs.type, cs.description]),
      ),
    );
  }

  return lines.join("\n");
}

// ── Suggestion / Apply Formatters ────────────────────────────────────

/**
 * Format apply-suggestion results.
 */
export function formatSuggestions(data: unknown): string {
  const result = data as {
    success?: boolean;
    appliedChanges?: number;
    suggestionId?: string;
  };

  if (result.success !== undefined) {
    const lines: string[] = [];
    lines.push(chalk.bold.underline("Apply Suggestion Result"));
    lines.push(
      `  Status:          ${result.success ? chalk.green("Success") : chalk.red("Failed")}`,
    );
    if (result.appliedChanges !== undefined) {
      lines.push(
        `  Applied changes: ${chalk.yellow(String(result.appliedChanges))}`,
      );
    }
    if (result.suggestionId) {
      lines.push(`  Suggestion ID:   ${result.suggestionId}`);
    }
    return lines.join("\n");
  }

  return formatJson(data);
}

// ── Workspace / Schedule Formatters ──────────────────────────────────

/**
 * Format workspace schedule projection data.
 */
export function formatWorkspace(data: unknown): string {
  const result = data as {
    summary: {
      scheduledCount: number;
      unscheduledCount: number;
      proposalCount: number;
      riskCount: number;
    };
    scheduled: Array<{
      taskId: string;
      title: string;
      priority: string;
      scheduledStartAt: string | null;
      scheduledEndAt: string | null;
      scheduleStatus: string | null;
    }>;
    unscheduled: Array<{
      taskId: string;
      title: string;
      priority: string;
    }>;
    risks: Array<{
      taskId: string;
      title: string;
      scheduleStatus: string | null;
    }>;
  };

  const lines: string[] = [];

  const s = result.summary;
  lines.push(chalk.bold.underline("Workspace Schedule Overview"));
  lines.push(
    `  Scheduled:   ${chalk.green(String(s.scheduledCount))}  ` +
    `Unscheduled: ${chalk.yellow(String(s.unscheduledCount))}  ` +
    `Proposals: ${chalk.cyan(String(s.proposalCount))}  ` +
    `Risks: ${chalk.red(String(s.riskCount))}`,
  );
  lines.push("");

  if (result.scheduled?.length > 0) {
    lines.push(chalk.bold("Scheduled Tasks:"));
    const rows = result.scheduled.slice(0, 20).map((t) => [
      t.taskId.slice(0, 8),
      t.title.slice(0, 30),
      t.priority,
      t.scheduledStartAt ?? null,
      t.scheduledEndAt ?? null,
      t.scheduleStatus,
    ]);
    lines.push(formatTable(["ID", "Title", "Priority", "Start", "End", "Status"], rows));
    if (result.scheduled.length > 20) {
      lines.push(chalk.dim(`  ... and ${result.scheduled.length - 20} more`));
    }
  }

  if (result.risks?.length > 0) {
    lines.push(chalk.bold("At-Risk Tasks:"));
    const riskRows = result.risks.map((t) => [
      t.taskId.slice(0, 8),
      t.title.slice(0, 40),
      t.scheduleStatus,
    ]);
    lines.push(formatTable(["ID", "Title", "Status"], riskRows));
  }

  return lines.join("\n");
}

// ── Error Utility ────────────────────────────────────────────────────

/**
 * Print an error message in red and exit.
 */
export function printError(message: string): never {
  console.error(chalk.red.bold("Error: ") + chalk.red(message));
  process.exit(1);
}
