import {
  archiveGoalAsset,
  createAssetUseTask,
  createGoalAssetReview,
  createAssetModificationTask,
  createGoalAssetJob,
  discardGoalAssetDraft,
  createGoalFormSubmission,
  getGoalAsset,
  listGoalAssets,
  listGoalInbox,
  openGoalAssetFile,
  openGoalStructuredArtifact,
  renameGoalAsset,
  resolveGoalInboxCandidate,
  restoreGoalAssetVersion,
  saveGoalAssetDraft,
  splitAcceptedResultIntoCandidates,
  submitGoalAssetDraft,
} from "../modules/goals/goal-workbench";
import {
  applyGoalAssetOwnershipProposal,
  generateGoalAssetOwnership,
} from "../modules/goals/goal-asset-ownership";

export function createGoalWorkbenchService() {
  return {
    listAssets: listGoalAssets,
    getAsset: getGoalAsset,
    openAssetFile: openGoalAssetFile,
    openStructuredArtifact: openGoalStructuredArtifact,
    renameAsset: renameGoalAsset,
    saveDraft: saveGoalAssetDraft,
    submitDraft: submitGoalAssetDraft,
    discardDraft: discardGoalAssetDraft,
    restoreVersion: restoreGoalAssetVersion,
    archiveAsset: archiveGoalAsset,
    listInbox: listGoalInbox,
    extractCandidates: splitAcceptedResultIntoCandidates,
    resolveCandidate: resolveGoalInboxCandidate,
    generateOwnershipProposal: generateGoalAssetOwnership,
    applyOwnershipProposal: applyGoalAssetOwnershipProposal,
    createSubmission: createGoalFormSubmission,
    createJob: createGoalAssetJob,
    createModificationTask: createAssetModificationTask,
    createUseTask: createAssetUseTask,
    createReview: createGoalAssetReview,
  };
}
