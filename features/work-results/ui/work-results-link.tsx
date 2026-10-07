import { Link } from "react-router-dom";
import { useI18n } from "@chrona/i18n";
import { Button } from "@shared/ui";

export function WorkResultsLink({ taskId }: { taskId: string }) {
  const { locale, messages } = useI18n();
  return <Button variant="ghost" size="sm" className="h-7 shrink-0 px-2 text-xs" asChild><Link to={`/${locale}/tasks/${encodeURIComponent(taskId)}/results`}>{messages.workResults.title}</Link></Button>;
}
