"use client";

import { useState } from "react";
import { PlanNodeDetailCard } from "./task-workspace-plan-detail-components";
import {
  PlanReviewSummaryPanel,
  PlanRevisionForm,
  type PlanReviewDecisionPanelProps,
} from "./task-workspace-plan-review-content";

function PlanReviewDecisionPanel({
  selectedNode,
  onAcceptPlan,
  onRevisePlan,
  ...props
}: PlanReviewDecisionPanelProps) {
  const [isRevising, setIsRevising] = useState(false);
  const [revisionScope, setRevisionScope] = useState<"plan" | "step">("plan");

  return (
    <aside
      className="space-y-2 xl:sticky xl:top-3 xl:self-start"
      aria-label="Plan review decision"
    >
      <PlanReviewSummaryPanel
        {...props}
        isRevising={isRevising}
        onAcceptPlan={onAcceptPlan}
        onToggleRevising={() => setIsRevising((value) => !value)}
      />
      {selectedNode ? <PlanNodeDetailCard node={selectedNode} copy={props.copy} /> : null}
      {isRevising ? (
        <PlanRevisionForm
          {...props}
          selectedNode={selectedNode}
          revisionScope={revisionScope}
          onRevisionScopeChange={setRevisionScope}
          onRevisePlan={onRevisePlan}
        />
      ) : null}
    </aside>
  );
}


export { PlanReviewDecisionPanel };
