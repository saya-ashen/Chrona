import type { ExecutionDeliveryTarget, ExecutionSignedStop } from "@chrona/contracts/steward";

declare const stopBrand: unique symbol;
export type VerifiedExecutionStop = { readonly [stopBrand]: true; readonly target: ExecutionDeliveryTarget; readonly digest: string; readonly statement: ExecutionSignedStop["statement"] };
