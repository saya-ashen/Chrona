import { NextResponse } from "next/server";
import { isAIAvailable, getAIAdapterInfo } from "@/modules/ai/ai-service";

/**
 * GET /api/ai/status — returns available AI adapters and their capabilities.
 * Useful for frontend to know what AI features are available.
 */
export async function GET() {
  try {
    const available = await isAIAvailable();
    const adapters = getAIAdapterInfo();

    return NextResponse.json({
      available,
      adapters,
    });
  } catch (error) {
    console.error("Error checking AI status:", error);
    return NextResponse.json(
      { available: false, adapters: [], error: "Failed to check AI status" },
      { status: 500 },
    );
  }
}
