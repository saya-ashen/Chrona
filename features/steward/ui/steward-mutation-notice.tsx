import { useI18n } from "@chrona/i18n";
import { Button } from "@shared/ui";
import type { useStewardMutation } from "../hooks/use-steward-mutation";

export function StewardMutationNotice({ mutation, refresh }: {
  mutation: ReturnType<typeof useStewardMutation>;
  refresh: () => void;
}) {
  const { messages } = useI18n();
  const c = messages.steward;
  return mutation.notice && (
    <p role={mutation.notice === "mutationError" ? "alert" : "status"}>
      {c[mutation.notice]}
      {mutation.notice === "mutationError" && (
        <Button onClick={() => { mutation.reset(); refresh(); }}>{c.retry}</Button>
      )}
    </p>
  );
}
