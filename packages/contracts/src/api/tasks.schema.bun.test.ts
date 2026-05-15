import { describe, expect, it } from "bun:test";
import {
  createTaskBodySchema,
  createTaskBodySchemaForSupportedRuntimes,
  updateTaskBodySchemaForSupportedRuntimes,
} from "./tasks.schema";

describe("task API schemas", () => {
  it("validates executionRuntime against a supplied supported runtime list", () => {
    const schema = createTaskBodySchemaForSupportedRuntimes(["openclaw", "local"]);

    expect(
      schema.parse({
        workspaceId: "workspace-1",
        title: "Use configured runtime",
        executionRuntime: "local",
      }),
    ).toMatchObject({ executionRuntime: "local" });

    expect(() =>
      schema.parse({
        workspaceId: "workspace-1",
        title: "Use unknown runtime",
        executionRuntime: "research",
      }),
    ).toThrow("Unsupported executionRuntime. Supported runtimes: openclaw, local");
  });

  it("keeps the reusable contract schema provider-agnostic", () => {
    expect(
      createTaskBodySchema.parse({
        workspaceId: "workspace-1",
        title: "Create through MCP contract",
        executionRuntime: "future-runtime",
      }),
    ).toMatchObject({ executionRuntime: "future-runtime" });

    expect(() =>
      createTaskBodySchema.parse({
        workspaceId: "workspace-1",
        title: "Blank runtime",
        executionRuntime: "  ",
      }),
    ).toThrow("executionRuntime is required");
  });

  it("validates update executionRuntime against the supplied runtime list", () => {
    const schema = updateTaskBodySchemaForSupportedRuntimes(["openclaw"]);

    expect(schema.parse({ executionRuntime: "openclaw" })).toMatchObject({
      executionRuntime: "openclaw",
    });
    expect(() => schema.parse({ executionRuntime: "local" })).toThrow(
      "Unsupported executionRuntime. Supported runtimes: openclaw",
    );
  });
});
