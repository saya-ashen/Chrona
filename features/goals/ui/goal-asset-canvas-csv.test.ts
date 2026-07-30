import { describe, expect, it } from "vitest";
import { csvFromGoalDataTable, goalDataTableFromCsv } from "./goal-asset-canvas-csv";

describe("CSV asset canvas adapter", () => {
  it("preserves quoted commas, escaped quotes, and multiline cells", () => {
    const table = goalDataTableFromCsv('name,note\nJane,"A, B"\nSam,"line 1\nline 2"\nLee,"said ""yes"""');
    expect(table?.rows.map((row) => row.values)).toMatchObject([
      { "column-0": "Jane", "column-1": "A, B" },
      { "column-0": "Sam", "column-1": "line 1\nline 2" },
      { "column-0": "Lee", "column-1": 'said "yes"' },
    ]);
    expect(csvFromGoalDataTable(table!)).toContain('Jane,"A, B"');
    expect(csvFromGoalDataTable(table!)).toContain('Sam,"line 1\nline 2"');
    expect(csvFromGoalDataTable(table!)).toContain('Lee,"said ""yes"""');
  });

  it("rejects malformed or headerless CSV", () => {
    expect(goalDataTableFromCsv("")).toBeNull();
    expect(goalDataTableFromCsv('name,note\nJane,"unterminated')).toBeNull();
  });
});
