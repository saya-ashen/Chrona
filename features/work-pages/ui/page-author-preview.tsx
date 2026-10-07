import { useState } from "react";
import { useI18n } from "@chrona/i18n";
import { Button } from "@shared/ui";
import { workPageSchema, type WorkPage } from "@chrona/ui-protocol";
import { WorkPageRenderer } from "./work-page-renderer";
export function PageAuthorPreview({ details }: { details: string }) {
  const c = useI18n().messages.workPages, [page, setPage] = useState<WorkPage | null>(null), [issues, setIssues] = useState<string[]>([]);
  function validate() {
    setPage(null); setIssues([]);
    try {
      if (new TextEncoder().encode(details).length > 96 * 1024) throw new Error("size");
      const raw: unknown = JSON.parse(details);
      const result = workPageSchema.safeParse(raw && typeof raw === "object" && "page" in raw ? raw.page : null);
      if (result.success) setPage(result.data); else setIssues(result.error.issues.slice(0, 12).map((i) => `${i.path.join(".").slice(0, 200)}: ${i.message.slice(0, 200)}`));
    } catch { setIssues([c.invalid]); }
  }
  return <details className="space-y-3 rounded-lg border p-4"><summary className="cursor-pointer font-medium">{c.authorPreview}</summary><p className="text-sm text-muted-foreground">{c.authorHint}</p><Button type="button" size="sm" variant="outline" onClick={validate}>{c.validate}</Button>
    {!!issues.length && <ul role="alert" className="space-y-1 text-xs">{issues.map((issue, i) => <li key={i}>{issue}</li>)}</ul>}
    {page && <div className="space-y-4 border-t pt-4"><p role="status" className="text-sm">{c.valid}</p><WorkPageRenderer page={page} versionId="preview" scope={{ taskId: "preview", occurrenceId: null }} inputs={{ entries: [], revision: null, headVersionId: "preview", canRespond: false, total: 0, nextOffset: null, view: "current" }} readOnly /></div>}
  </details>;
}
