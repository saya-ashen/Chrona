import { NextResponse } from "next/server";
import { db } from "@/modules/db";
import type { TaskChange } from "@/modules/ai/types";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { workspaceId, suggestionId, changes } = body;

    if (!workspaceId || !suggestionId || !changes) {
      return NextResponse.json(
        { error: "workspaceId, suggestionId, and changes are required" },
        { status: 400 },
      );
    }

    // 验证所有任务属于该工作空间
    const taskIds = (changes as TaskChange[]).map((c) => c.taskId);
    const tasks = await db.task.findMany({
      where: {
        id: { in: taskIds },
        workspaceId,
      },
    });

    if (tasks.length !== taskIds.length) {
      return NextResponse.json(
        { error: "Some tasks do not belong to this workspace" },
        { status: 403 },
      );
    }

    // 批量更新任务的 projection
    const updatePromises = (changes as TaskChange[]).map((change) => {
      const updateData: {
        scheduledStartAt?: Date;
        scheduledEndAt?: Date;
        updatedAt: Date;
      } = {
        updatedAt: new Date(),
      };

      if (change.scheduledStartAt) {
        updateData.scheduledStartAt = new Date(change.scheduledStartAt);
      }
      if (change.scheduledEndAt) {
        updateData.scheduledEndAt = new Date(change.scheduledEndAt);
      }

      return db.taskProjection.update({
        where: {
          taskId_workspaceId: {
            taskId: change.taskId,
            workspaceId,
          },
        },
        data: updateData,
      });
    });

    const results = await Promise.all(updatePromises);

    return NextResponse.json({
      success: true,
      appliedChanges: results.length,
      suggestionId,
    });
  } catch (error) {
    console.error("Error applying suggestion:", error);
    return NextResponse.json(
      { error: "Failed to apply suggestion" },
      { status: 500 },
    );
  }
}
