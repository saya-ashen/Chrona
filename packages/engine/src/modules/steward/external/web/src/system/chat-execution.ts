export type ApplicationDelivery = {
  receipt: {
    receiptId: string; admissionId: string; requestKey: string;
    state: "submitted" | "pending_approval" | "approved" | "rejected";
    members: {
      name: string; moduleId: string; hash: string;
      status: "building" | "testing" | "pending_review" | "approved" | "rejected";
      versionId: string; expectedActiveHash: string | null; materialDigest: string; selected: boolean;
    }[];
    submitter: { moduleId: string; hash: string }; approvalId: string | null;
  };
  receiptCheck: "current" | "unknown"; checkedAt?: string;
  targets: {
    name: string; moduleId: string; hash: string;
    activation: "unknown" | "active" | "different" | "inactive";
    health: "unknown" | "observed" | "issue";
    pages: { id: string; title: string; href: string }[];
    pagesCheck: "unknown" | "current";
  }[];
  browser: "unknown";
};
export type Execution = { runId: string; status: string; active: boolean; phase?: string; reason?: string; canContinue: boolean; replyPending?: boolean; pendingAdmission?: { requestKey: string }; pendingContinuation?: { runId: string; requestKey: string }; applicationDelivery?: ApplicationDelivery[] };
