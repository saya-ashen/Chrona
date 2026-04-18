import { NextResponse } from "next/server";
import { isAIAvailable, getAIClientInfo } from "@/modules/ai/ai-service";

/**
 * GET /api/ai/status — returns available AI clients and their feature bindings.
 */
export async function GET() {
  try {
    const available = await isAIAvailable();
    const clients = await getAIClientInfo();

    return NextResponse.json({
      available,
      clients,
    });
  } catch (error) {
    console.error("Error checking AI status:", error);
    return NextResponse.json(
      { available: false, clients: [], error: "Failed to check AI status" },
      { status: 500 },
    );
  }
}
