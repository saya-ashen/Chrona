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
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Save changes before regenerating?</DialogTitle>
          <DialogDescription>
        You have unsaved task configuration changes. Save them and use the new
        configuration to regenerate the plan.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            type="button"
            onClick={onCancel}
            disabled={isSaving}
            variant="outline"
            size="sm"
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={onConfirm}
            disabled={isSaving}
            size="sm"
          >
            {isSaving ? "Saving..." : "Save and regenerate"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
