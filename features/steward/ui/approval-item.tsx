import { Link } from "react-router-dom";
import { pageHref } from "../model/workspace";
import { formatShortDateTime } from "../model/format";
import type { Approval } from "@chrona/contracts";
import { useI18n } from "@chrona/i18n";
import { Alert, AlertDescription, Button } from "@shared/ui";
import type { StewardClient } from "../model/client";
import { useStewardMutation } from "../hooks/use-steward-mutation";

export function ApprovalItem({ approval, client, refresh }: { approval: Approval; client: StewardClient; refresh: () => void }) {
  const { messages, locale } = useI18n();
  const copy = messages.steward.workspace;
  const mutation = useStewardMutation(refresh);
  const resolve = (decision: "approve" | "deny", scope: "once" | "affair") => mutation.run(() => client.resolveApproval(approval.id, { decision, scope }));
  return <article className="grid gap-1.5 border-l-[3px] border-warning px-3.5 py-3">
    <div className="flex flex-wrap items-baseline gap-2.5">
      <h3 className="font-medium">{approval.title}</h3>
      {approval.affairId && approval.affairTitle && <span className="text-xs text-muted-foreground">· <Link className="underline decoration-border" to={pageHref(locale, approval.affairId)}>{approval.affairTitle}</Link></span>}
      <time className="ml-auto text-xs text-muted-foreground tabular-nums" dateTime={approval.createdAt}>{formatShortDateTime(approval.createdAt, locale)}</time>
    </div><p className="max-w-[72ch] text-[13px] text-muted-foreground">{approval.detail}</p>
    <details><summary>{copy.preview}</summary><pre className="whitespace-pre-wrap break-words">{approval.preview}</pre></details>
    <div className="flex flex-wrap gap-2">
      <Button disabled={mutation.pending} onClick={() => void resolve("approve", "once")}>{copy.once}</Button>
      {approval.affairId && <Button variant="outline" disabled={mutation.pending} onClick={() => void resolve("approve", "affair")}>{copy.always}</Button>}
      <Button variant="outline" disabled={mutation.pending} onClick={() => void resolve("deny", "once")}>{copy.deny}</Button>
    </div>
    {mutation.error && <Alert variant="destructive"><AlertDescription>{messages.steward.foundation[mutation.error.messageKey]}</AlertDescription></Alert>}
  </article>;
}
