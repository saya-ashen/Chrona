type TaskPlanSaveBeforeRegenerateDialogProps = {
  isSaving: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

export function TaskPlanSaveBeforeRegenerateDialog({
  isSaving,
  onCancel,
  onConfirm,
}: TaskPlanSaveBeforeRegenerateDialogProps) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Save changes before regenerating"
      className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"
    >
      <p className="font-medium">Save changes before regenerating?</p>
      <p className="mt-1 text-xs text-amber-800">
        You have unsaved task configuration changes. Save them and use the new
        configuration to regenerate the plan.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={isSaving}
          className="rounded-lg border border-amber-300 bg-background px-3 py-1.5 text-xs font-medium text-amber-900 transition hover:bg-amber-100 disabled:opacity-60"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={isSaving}
          className="rounded-lg border border-amber-500 bg-amber-500 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-amber-600 disabled:opacity-60"
        >
          {isSaving ? "Saving..." : "Save and regenerate"}
        </button>
      </div>
    </div>
  );
}
