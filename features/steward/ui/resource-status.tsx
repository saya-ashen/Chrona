import { useI18n } from "@chrona/i18n";
import { Alert, AlertDescription, Button, Skeleton } from "@shared/ui";
import type { StewardClientError } from "../model/client";

export function ResourceStatus({
  resource,
}: {
  resource: { data?: unknown; loading: boolean; error: StewardClientError | null; refresh: () => void };
}) {
  const copy = useI18n().messages.steward.foundation;
  return (
    <>
      {resource.loading && (resource.data === null || resource.data === undefined) && (
        <div role="status" aria-label={copy.loading}>
          <Skeleton className="h-12 w-full" />
        </div>
      )}
      {resource.error && (
        <Alert variant="destructive">
          <AlertDescription>
            {copy[resource.error.messageKey]}
            <Button onClick={resource.refresh}>{copy.retry}</Button>
          </AlertDescription>
        </Alert>
      )}
    </>
  );
}
export function MutationStatus({
  mutation,
}: {
  mutation: { pending: boolean; error: StewardClientError | null };
}) {
  const copy = useI18n().messages.steward.foundation;
  return (
    <>
      {mutation.pending && <p role="status">{copy.pending}</p>}
      {mutation.error && <p role="alert">{mutation.error.detail ?? copy[mutation.error.messageKey]}</p>}
    </>
  );
}
