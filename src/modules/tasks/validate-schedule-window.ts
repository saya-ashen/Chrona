export function validateScheduleWindow(input: {
  scheduledStartAt?: Date | null;
  scheduledEndAt?: Date | null;
}) {
  const { scheduledStartAt, scheduledEndAt } = input;

  if (!scheduledStartAt || !scheduledEndAt) {
    return;
  }

  if (scheduledEndAt.getTime() < scheduledStartAt.getTime()) {
    throw new Error("scheduledEndAt cannot be earlier than scheduledStartAt");
  }
}
