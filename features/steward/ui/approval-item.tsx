import type { Approval } from "@chrona/contracts";
import { useI18n } from "@chrona/i18n";
import { Alert, AlertDescription, Button } from "@shared/ui";
import type { StewardClient } from "../model/client";
import { useStewardMutation } from "../hooks/use-steward-mutation";

export function ApprovalItem({ approval, client, refresh }: { approval: Approval; client: StewardClient; refresh: () => void }) {
  const { messages } = useI18n();
  const copy = messages.steward.workspace;
  const mutation = useStewardMutation(refresh);
  const resolve = (decision: "approve" | "deny", scope: "once" | "affair") => mutation.run(() => client.resolveApproval(approval.id, { decision, scope }));
  return <article className="grid gap-3 p-4">
    <h3 className="font-medium">{approval.title}</h3><p>{approval.detail}</p>
    <details><summary>{copy.preview}</summary><pre className="whitespace-pre-wrap break-words">{approval.preview}</pre></details>
    <div className="flex flex-wrap gap-2">
      <Button disabled={mutation.pending} onClick={() => void resolve("approve", "once")}>{copy.once}</Button>
      {approval.affairId && <Button variant="outline" disabled={mutation.pending} onClick={() => void resolve("approve", "affair")}>{copy.always}</Button>}
      <Button variant="outline" disabled={mutation.pending} onClick={() => void resolve("deny", "once")}>{copy.deny}</Button>
    </div>
    {mutation.error && <Alert variant="destructive"><AlertDescription>{messages.steward.foundation[mutation.error.messageKey]}</AlertDescription></Alert>}
  </article>;
}
