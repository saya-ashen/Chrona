import { Link } from "react-router-dom";
import { useI18n } from "@chrona/i18n";
import { useAffair, useResult } from "../hooks/use-affairs";
import { ResultContent } from "./result-content";
import { ResourceStatus } from "./resource-status";

export function ResultPage() {
  const detail = useAffair(),
    { messages, locale } = useI18n();
  const resource = useResult(detail.client, detail.affairId);
  return (
    <div className="mx-auto grid w-full min-w-0 max-w-5xl gap-5 p-4 [overflow-wrap:anywhere]">
      <Link to={`/${locale}/affairs/${encodeURIComponent(detail.affairId)}`}>
        ← {detail.data?.affair.title ?? messages.steward.shell.affair}
      </Link>
      <ResourceStatus resource={detail} />
      <ResourceStatus resource={resource} />
      {resource.data && detail.data && (
        <ResultContent
          result={resource.data}
          versions={detail.data.resultVersions}
          client={detail.client}
          refresh={detail.refresh}
        />
      )}
    </div>
  );
}
