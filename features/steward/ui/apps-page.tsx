import { Link } from "react-router-dom";
import { useI18n } from "@chrona/i18n";
import { useStewardSession } from "../hooks/use-steward-session";
import { useStewardResource } from "../hooks/use-steward";
import { groupWorkspaceApps, pageHref } from "../model/workspace";
import { PageColumn, Section, Surface } from "./layout";
import { ResourceStatus } from "./resource-status";

export function AppsPage() {
  const { messages, locale } = useI18n(), c = messages.steward.apps;
  const { today } = useStewardSession();
  const apps = useStewardResource(today.client.apps);
  return <PageColumn><h1 className="text-2xl font-semibold">{c.title}</h1><ResourceStatus resource={apps} />
    {apps.data && (!apps.data.items.length ? <p>{c.empty}</p> : groupWorkspaceApps(apps.data.items).filter(group => group.items.length).map(group => <Section key={group.key} title={c[group.key]} count={group.items.length}><Surface>
      {group.items.map(app => <Link key={app.id} className="grid gap-1 p-3 hover:underline" to={pageHref(locale, app.id)}><span className="font-medium">{app.name}</span><span className="text-sm text-muted-foreground">{app.description}</span></Link>)}
    </Surface></Section>))}
  </PageColumn>;
}
