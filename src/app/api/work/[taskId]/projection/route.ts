import { NextResponse } from "next/server";
import { getWorkPage } from "@/modules/queries/get-work-page";
import { syncTaskRunForRead } from "@/modules/runtime/openclaw/freshness";

export async function GET(
  _request: Request,
  context: { params: Promise<{ taskId: string }> },
) {
  const { taskId } = await context.params;
  await syncTaskRunForRead(taskId);

  return NextResponse.json(await getWorkPage(taskId));
}
