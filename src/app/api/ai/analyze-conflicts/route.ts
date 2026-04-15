import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { analyzeConflicts } from "@/modules/ai/conflict-analyzer";
import type { ScheduledTaskInfo } from "@/modules/ai/types";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { workspaceId, date } = body;

    if (!workspaceId) {
      return NextResponse.json(
        { error: "workspaceId is required" },
        { status: 400 },
      );
    }

    // 解析日期范围（如果提供了 date，分析该天；否则分析未来 7 天）
    let startDate: Date;
    let endDate: Date;

    if (date) {
      startDate = new Date(date);
      startDate.setHours(0, 0, 0, 0);
      endDate = new Date(startDate);
      endDate.setDate(endDate.getDate() + 1);
    } else {
      startDate = new Date();
      startDate.setHours(0, 0, 0, 0);
      endDate = new Date(startDate);
      endDate.setDate(endDate.getDate() + 7);
    }

    // 获取调度任务
    const projections = await db.taskProjection.findMany({
      where: {
        workspaceId,
        scheduledStartAt: {
          gte: startDate,
          lt: endDate,
        },
      },
      include: {
        task: {
          include: {
            dependencies: {
              select: {
                dependsOnTaskId: true,
              },
            },
          },
        },
      },
    });

    // 转换为 ScheduledTaskInfo 格式
    const tasks: ScheduledTaskInfo[] = projections
      .filter(
        (p) =>
          p.scheduledStartAt !== null &&
          p.scheduledEndAt !== null &&
          p.task !== null,
      )
      .map((p) => ({
        taskId: p.taskId,
        title: p.task.title,
        priority: p.task.priority,
        scheduledStartAt: p.scheduledStartAt!,
        scheduledEndAt: p.scheduledEndAt!,
        dueAt: p.task.dueAt,
        estimatedMinutes: Math.round(
          (p.scheduledEndAt!.getTime() - p.scheduledStartAt!.getTime()) / 60000,
        ),
        dependencies: p.task.dependencies.map((d) => d.dependsOnTaskId),
      }));

    // 分析冲突
    const result = analyzeConflicts(tasks);

    return NextResponse.json(result);
  } catch (error) {
    console.error("Error analyzing conflicts:", error);
    return NextResponse.json(
      { error: "Failed to analyze conflicts" },
      { status: 500 },
    );
  }
}
