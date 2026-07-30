import { describe, expect, it } from "vitest";
import { LocaleType, type IWorkbookData } from "@univerjs/core";
import type { GoalDataTableContent } from "@chrona/contracts";
import { goalDataTableToWorkbook, workbookToGoalDataTable } from "./goal-asset-canvas-spreadsheet";

const table: GoalDataTableContent = {
  schemaVersion: 1,
  columns: [
    { id: "faculty", label: "Faculty", type: "text" },
    { id: "score", label: "Score", type: "number" },
  ],
  rows: [
    { id: "row-a", values: { faculty: "Smith, Jane", score: 9 } },
  ],
};

describe("SpreadsheetAssetCanvas adapters", () => {
  it("preserves stable row and column identities through a workbook edit", () => {
    const snapshot = goalDataTableToWorkbook(table, "Tracker", LocaleType.EN_US) as IWorkbookData;
    snapshot.sheets["chrona-asset-sheet"]!.cellData![0]![0]!.v = "Advisor";
    snapshot.sheets["chrona-asset-sheet"]!.cellData![1]![1]!.v = 10;

    expect(workbookToGoalDataTable(snapshot, table)).toEqual({
      schemaVersion: 1,
      columns: [
        { id: "faculty", label: "Advisor", type: "text" },
        { id: "score", label: "Score", type: "number" },
      ],
      rows: [
        { id: "row-a", values: { faculty: "Smith, Jane", score: 10 } },
      ],
    });
  });

  it("normalizes unsupported spreadsheet cell values to null", () => {
    const snapshot = goalDataTableToWorkbook(table, "Tracker", LocaleType.EN_US) as IWorkbookData;
    snapshot.sheets["chrona-asset-sheet"]!.cellData![1]![0]!.v = false;

    expect(workbookToGoalDataTable(snapshot, table).rows[0]!.values.faculty).toBeNull();
  });

  it("persists added workbook rows and columns with stable generated IDs", () => {
    const snapshot = goalDataTableToWorkbook(table, "Tracker", LocaleType.EN_US) as IWorkbookData;
    const cells = snapshot.sheets["chrona-asset-sheet"]!.cellData!;
    cells[0]![2] = { v: "Notes" };
    cells[2] = { 0: { v: "Lee" }, 1: { v: 8 }, 2: { v: "Follow up" } };

    const converted = workbookToGoalDataTable(snapshot, table);

    expect(converted.columns).toHaveLength(3);
    expect(converted.columns[2]!.label).toBe("Notes");
    expect(converted.rows).toHaveLength(2);
    expect(converted.rows[0]!.id).toBe("row-a");
    expect(converted.rows[1]!.values[converted.columns[2]!.id]).toBe("Follow up");
  });

  it("persists formulas as CSV-safe source strings", () => {
    const snapshot = goalDataTableToWorkbook(table, "Tracker", LocaleType.EN_US) as IWorkbookData;
    snapshot.sheets["chrona-asset-sheet"]!.cellData![1]![1] = { f: "SUM(B3:B4)" };

    expect(workbookToGoalDataTable(snapshot, table).rows[0]!.values.score).toBe("=SUM(B3:B4)");
  });
});
