import {
  archiveGoalAsset,
  createAssetModificationTask,
  createGoalAssetJob,
  createGoalFormSubmission,
  getGoalAsset,
  listGoalAssets,
  listGoalInbox,
  openGoalAssetFile,
  renameGoalAsset,
  resolveGoalInboxCandidate,
  restoreGoalAssetVersion,
  saveGoalAssetDraft,
  splitAcceptedResultIntoCandidates,
  submitGoalAssetDraft,
} from "../modules/goals/goal-workbench";

export function createGoalWorkbenchService() {
  return {
    listAssets: listGoalAssets,
    getAsset: getGoalAsset,
    openAssetFile: openGoalAssetFile,
    renameAsset: renameGoalAsset,
    saveDraft: saveGoalAssetDraft,
    submitDraft: submitGoalAssetDraft,
    restoreVersion: restoreGoalAssetVersion,
    archiveAsset: archiveGoalAsset,
    listInbox: listGoalInbox,
    extractCandidates: splitAcceptedResultIntoCandidates,
    resolveCandidate: resolveGoalInboxCandidate,
    createSubmission: createGoalFormSubmission,
    createJob: createGoalAssetJob,
    createModificationTask: createAssetModificationTask,
  };
}
