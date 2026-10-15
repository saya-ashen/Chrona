import { Link } from "react-router-dom";
import { localizeHref, useI18n } from "@chrona/i18n";
import { Button } from "@shared/ui";

export function NotFoundPage() {
  const { locale, messages } = useI18n();
  const copy = messages.steward.shell;
  return <section className="flex min-h-[60vh] min-w-0 flex-col items-center justify-center gap-4 p-4 text-center">
    <h1 className="text-6xl font-bold text-muted-foreground">404</h1>
    <h2 className="text-xl">{copy.notFound}</h2>
    <p className="text-muted-foreground">{copy.notFoundDescription}</p>
    <Button variant="outline" asChild><Link to={localizeHref(locale, "/")}>{copy.goHome}</Link></Button>
  </section>;
}
