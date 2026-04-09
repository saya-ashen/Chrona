import { WorkspaceStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db";

export const DEFAULT_WORKSPACE_ID = "ws_default";

export type DefaultWorkspace = {
  id: string;
  name: string;
  description: string | null;
  defaultRuntime: string;
  status: WorkspaceStatus;
};

export class DefaultWorkspaceError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = "DefaultWorkspaceError";

    if (options?.cause) {
      this.cause = options.cause;
    }
  }

  declare cause?: unknown;
}

const defaultWorkspaceSelect = {
  id: true,
  name: true,
  description: true,
  defaultRuntime: true,
  status: true,
} as const;

export async function getDefaultWorkspace(): Promise<DefaultWorkspace> {
  const activeWorkspace = await db.workspace.findFirst({
    where: { status: WorkspaceStatus.Active },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: defaultWorkspaceSelect,
  });

  if (activeWorkspace) {
    return activeWorkspace;
  }

  const existingWorkspace = await db.workspace.findFirst({
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: defaultWorkspaceSelect,
  });

  if (existingWorkspace) {
    return existingWorkspace;
  }

  try {
    return await db.workspace.create({
      data: {
        id: DEFAULT_WORKSPACE_ID,
        name: "Default Workspace",
        description: "Auto-created primary workspace for the control plane.",
        defaultRuntime: "openclaw",
        status: WorkspaceStatus.Active,
      },
      select: defaultWorkspaceSelect,
    });
  } catch (error) {
    const createdWorkspace = await db.workspace.findUnique({
      where: { id: DEFAULT_WORKSPACE_ID },
      select: defaultWorkspaceSelect,
    });

    if (createdWorkspace) {
      return createdWorkspace;
    }

    throw new DefaultWorkspaceError("Unable to resolve or initialize the default workspace.", {
      cause: error,
    });
  }
}
