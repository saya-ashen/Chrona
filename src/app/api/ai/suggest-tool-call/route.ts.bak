/**
 * Tool execution endpoint for OpenClaw schedule suggest plugin.
 *
 * When the OpenClaw agent calls a schedule tool (e.g. schedule.list_tasks),
 * OpenClaw's plugin framework can POST to this endpoint to execute the
 * tool and return results to the agent's reasoning flow.
 *
 * This endpoint is meant to be called by the OpenClaw plugin, NOT by
 * the browser directly.
 *
 * Request body:
 * {
 *   "tool_name": "schedule.list_tasks",
 *   "arguments": { ... },
 *   "workspace_id": "ws_default",
 *   "request_id": "uuid"       // For correlation
 * }
 *
 * Response:
 * {
 *   "success": true,
 *   "data": { ... },
 *   "request_id": "uuid"
 * }
 */

import { NextResponse } from "next/server";
import { executeScheduleTool } from "@/modules/ai/schedule-suggest-plugin";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      tool_name,
      arguments: toolArgs,
      workspace_id,
      request_id,
    } = body as {
      tool_name?: string;
      arguments?: Record<string, unknown>;
      workspace_id?: string;
      request_id?: string;
    };

    if (!tool_name) {
      return NextResponse.json(
        { error: "tool_name is required" },
        { status: 400 },
      );
    }

    const workspaceId = workspace_id ?? "ws_default";

    const result = await executeScheduleTool({
      name: tool_name,
      arguments: toolArgs ?? {},
      workspaceId,
    });

    return NextResponse.json({
      ...result,
      request_id,
    });
  } catch (error) {
    console.error("Error executing suggest tool:", error);
    return NextResponse.json(
      {
        success: false,
        error: "Tool execution failed",
        data: null,
      },
      { status: 500 },
    );
  }
}
