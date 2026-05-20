import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

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
    <Dialog open onOpenChange={(open) => { if (!open) onCancel(); }}>
      <DialogContent className="border-amber-200 bg-amber-50 text-amber-900 sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Save changes before regenerating?</DialogTitle>
          <DialogDescription className="text-amber-800">
        You have unsaved task configuration changes. Save them and use the new
        configuration to regenerate the plan.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="border-amber-200 bg-amber-100/60">
          <Button
            type="button"
            onClick={onCancel}
            disabled={isSaving}
            variant="outline"
            size="sm"
            className="border-amber-300 text-amber-900 hover:bg-amber-100"
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={onConfirm}
            disabled={isSaving}
            size="sm"
            className="bg-amber-500 text-white hover:bg-amber-600"
          >
            {isSaving ? "Saving..." : "Save and regenerate"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
