/* eslint-disable complexity -- MCP tool adaptation validates heterogeneous SDK payloads explicitly. */
import { createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

import type { ProviderToolDefinition } from "@chrona/providers-foundation";

export const RUN_TOOLS_MCP_SERVER_NAME = "run_tools";

type JsonSchema = Record<string, unknown>;
type JsonSchemaProperty = JsonSchema | boolean;

function asSchema(value: unknown): JsonSchema | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonSchema
    : undefined;
}

function schemaFor(value: JsonSchemaProperty | undefined): z.ZodTypeAny {
  if (value === false) return z.never();
  const schema = asSchema(value);
  if (!schema) return z.unknown();

  const values = Array.isArray(schema.enum) ? schema.enum : undefined;
  if (values?.length) return z.enum(values.map(String) as [string, ...string[]]);

  let result: z.ZodTypeAny;
  switch (schema.type) {
    case "string": result = z.string(); break;
    case "number": result = z.number(); break;
    case "integer": result = z.number().int(); break;
    case "boolean": result = z.boolean(); break;
    case "array": result = z.array(schemaFor(schema.items as JsonSchemaProperty | undefined)); break;
    case "object": {
      const properties = asSchema(schema.properties) ?? {};
      const required = new Set(Array.isArray(schema.required) ? schema.required.filter((name): name is string => typeof name === "string") : []);
      const shape: Record<string, z.ZodTypeAny> = {};
      for (const [name, property] of Object.entries(properties)) {
        const propertySchema = schemaFor(property as JsonSchemaProperty);
        shape[name] = required.has(name) ? propertySchema : propertySchema.optional();
      }
      result = z.object(shape).passthrough();
      break;
    }
    default: result = z.unknown();
  }
  return result;
}

function inputShape(inputSchema: ProviderToolDefinition["inputSchema"]): z.ZodRawShape {
  const schema = asSchema(inputSchema);
  const properties = asSchema(schema?.properties) ?? {};
  const required = new Set(Array.isArray(schema?.required) ? schema.required.filter((name): name is string => typeof name === "string") : []);
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const [name, property] of Object.entries(properties)) {
    const propertySchema = schemaFor(property as JsonSchemaProperty);
    shape[name] = required.has(name) ? propertySchema : propertySchema.optional();
  }
  return shape;
}

/**
 * Expose the request-declared tools through the Agent SDK's in-process MCP
 * transport. This is intentionally protocol-only: domain services own the
 * meaning of tool calls, while the provider only acknowledges delivery.
 */
export function createRunToolsMcpServer(input: {
  tools: readonly ProviderToolDefinition[];
  onToolAccepted?: (toolName: string) => void;
}) {
  return createSdkMcpServer({
    name: RUN_TOOLS_MCP_SERVER_NAME,
    tools: input.tools.map((tool) => ({
      name: tool.name,
      description: tool.description ?? tool.name,
      inputSchema: inputShape(tool.inputSchema),
      async handler(args) {
        input.onToolAccepted?.(tool.name);
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ ok: true, tool: tool.name, input: args }) }],
          structuredContent: { ok: true, tool: tool.name, input: args },
        };
      },
    })),
  });
}
