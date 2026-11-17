import { StewardError } from "../errors";
import { CallError } from "../modules/module-call-error";

const rejected = Symbol("execution-control-rejected");
type ValidationError = CallError | StewardError;
export type ExecutionControlRejection = ValidationError & { readonly [rejected]: true };

/** Only admission validation errors qualify; storage and delivery failures remain unknown. */
export function isExecutionControlValidationError(error: unknown): error is ValidationError {
  return (error instanceof CallError || error instanceof StewardError)
    && ["not_found", "conflict", "invalid", "forbidden", "capacity"].includes(error.code);
}

/** Called after the admission transaction rolls back. Preserve the original error and code. */
export function markExecutionControlRejected(error: ValidationError): ExecutionControlRejection {
  Object.defineProperty(error, rejected, { value: true });
  return error as ExecutionControlRejection;
}
