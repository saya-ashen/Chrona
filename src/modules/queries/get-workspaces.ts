import { db } from "@/lib/db";

export async function getWorkspaces() {
  return db.workspace.findMany({
    orderBy: { updatedAt: "desc" },
    include: {
      _count: {
        select: { tasks: true },
      },
    },
  });
}
