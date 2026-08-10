export type TaskConfigFormDraft = {
  title: string;
  description: string;
  priority: "Low" | "Medium" | "High" | "Urgent";
  dueAt: Date | null;
  scheduledStartAt: Date | null;
  scheduledEndAt: Date | null;
};
