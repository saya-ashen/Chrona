import { NextResponse } from "next/server";
import { getWorkPage, WorkPageTaskNotFoundError } from "@/modules/queries/get-work-page";

export async function GET(
  _request: Request,
  context: { params: Promise<{ taskId: string }> },
) {
  const { taskId } = await context.params;

  try {
    return NextResponse.json(await getWorkPage(taskId));
  } catch (error) {
    if (error instanceof WorkPageTaskNotFoundError) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    throw error;
  }
}
