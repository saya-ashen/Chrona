import { NextResponse } from "next/server";
import { getMemoryConsole } from "@/modules/queries/get-memory-console";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const workspaceId = searchParams.get("workspaceId");

  if (!workspaceId) {
    return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
  }

  return NextResponse.json(await getMemoryConsole(workspaceId));
}
