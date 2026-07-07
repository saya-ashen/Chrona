import { db } from "@/lib/db";

export const START_WITH_CHRONA_PREFERENCE_KEY = "startWithChrona";
const LOCAL_USER_ID = "local";

type StartWithChronaPreferenceValue = {
  completedAt?: unknown;
};

function completedAtFromValue(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const completedAt = (value as StartWithChronaPreferenceValue).completedAt;
  return typeof completedAt === "string" && completedAt.trim() ? completedAt : null;
}

export async function getStartWithChronaPreference(workspaceId: string) {
  const preference = await db.workspaceUserPreference.findUnique({
    where: {
      workspaceId_userId_key: {
        workspaceId,
        userId: LOCAL_USER_ID,
        key: START_WITH_CHRONA_PREFERENCE_KEY,
      },
    },
    select: { value: true },
  });

  return { completedAt: completedAtFromValue(preference?.value) };
}

export async function setStartWithChronaPreference(input: { workspaceId: string; completedAt: string | null }) {
  const value = { completedAt: input.completedAt };
  const preference = await db.workspaceUserPreference.upsert({
    where: {
      workspaceId_userId_key: {
        workspaceId: input.workspaceId,
        userId: LOCAL_USER_ID,
        key: START_WITH_CHRONA_PREFERENCE_KEY,
      },
    },
    create: {
      workspaceId: input.workspaceId,
      userId: LOCAL_USER_ID,
      key: START_WITH_CHRONA_PREFERENCE_KEY,
      value,
    },
    update: { value },
    select: { value: true },
  });

  return { completedAt: completedAtFromValue(preference.value) };
}
