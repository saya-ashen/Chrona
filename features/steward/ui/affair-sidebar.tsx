import { Link } from "react-router-dom";
import { useI18n } from "@chrona/i18n";
import type { AffairDetail } from "@chrona/contracts";
import {
  Button,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@shared/ui";
import { useCareForm } from "../hooks/use-affairs";
import { useStewardMutation } from "../hooks/use-steward-mutation";
import type { StewardClient } from "../model/client";
import { formatCadence } from "../model/format";
import { MutationStatus } from "./resource-status";

export function AffairSidebar({
  detail,
  client,
  refresh,
}: {
  detail: AffairDetail;
  client: StewardClient;
  refresh: () => void;
}) {
  const { messages, locale } = useI18n(),
    copy = messages.steward.affairs,
    a = detail.affair;
  const form = useCareForm(client, a, refresh),
    revoke = useStewardMutation(refresh);
  return (
    <aside className="grid min-w-0 gap-6">
      <section className="grid gap-2">
        <h2 className="font-semibold">{copy.care}</h2>
        {a.care ? (
          <>
            <p>
              {formatCadence(a.care.cadenceSeconds, copy.cadence, locale)} ·{" "}
              {a.care.notify === "now" ? copy.nowNotify : copy[a.care.notify]}
            </p>
            {a.care.lastCheckAt && (
              <p>
                {copy.lastCheck}: {new Date(a.care.lastCheckAt).toLocaleString(locale)}
              </p>
            )}
            {a.care.nextCheckAt && (
              <p>
                {copy.nextCheck}: {new Date(a.care.nextCheckAt).toLocaleString(locale)}
              </p>
            )}
          </>
        ) : (
          <p>{copy.noCare}</p>
        )}
        {!form.editing ? (
          <Button variant="outline" disabled={form.pending} onClick={form.begin}>
            {a.care ? copy.edit : copy.startCare}
          </Button>
        ) : (
          <form
            className="grid gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void form.save();
            }}
          >
            <label>
              {copy.minutes}
              <Input
                type="number"
                min={5}
                max={10080}
                step={1}
                value={form.minutes}
                disabled={form.pending}
                onChange={(e) => form.setMinutes(e.target.value)}
              />
            </label>
            <Select value={form.notify} onValueChange={form.setNotify} disabled={form.pending}>
              <SelectTrigger aria-label={copy.notify}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="now">{copy.nowNotify}</SelectItem>
                <SelectItem value="digest">{copy.digest}</SelectItem>
                <SelectItem value="web">{copy.web}</SelectItem>
              </SelectContent>
            </Select>
            {form.invalid && <p role="alert">{copy.careInvalid}</p>}
            <Button disabled={form.pending}>{copy.save}</Button>
            <Button
              type="button"
              variant="ghost"
              disabled={form.pending}
              onClick={() => form.setEditing(false)}
            >
              {copy.cancel}
            </Button>
          </form>
        )}
        {a.care && (
          <Button variant="ghost" disabled={form.pending} onClick={() => void form.stop()}>
            {copy.stopCare}
          </Button>
        )}
        <MutationStatus mutation={form} />
      </section>
      {a.handling && (
        <section>
          <h2 className="font-semibold">{copy.handling}</h2>
          <p>{copy.modes[a.handling.mode]}</p>
          <p>{a.handling.rationale}</p>
        </section>
      )}
      {!a.care?.connectionId && detail.tools.length === 0 ? (
        <p className="text-sm text-muted-foreground">{copy.noTools}</p>
      ) : (
        <section>
          <h2 className="font-semibold">{copy.tools}</h2>
          {a.care?.connectionId && (
            <Link className="underline" to={`/${locale}/settings`}>
              {copy.connectedSource}
            </Link>
          )}
          {detail.tools.length === 0 && <p>{copy.none}</p>}
          <ul className="grid gap-3">
            {detail.tools.map((tool) => (
              <li key={tool.id}>
                <p>
                  {tool.kind === "panel" ? <Link className="underline" to={`/${locale}/tools/${encodeURIComponent(tool.id)}`}>{tool.name}</Link> : tool.name} · {copy.toolStates[tool.state]}
                </p>
                <p>{tool.purpose}</p>
                {tool.kind === "script" && (
                  <p>
                    {copy.version} {tool.version} ·{" "}
                    {tool.approvedVersion === tool.version
                      ? `${copy.approved} ${tool.approvedVersion}`
                      : copy.notApproved}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
      {detail.grants.length > 0 && (
        <section>
          <h2 className="font-semibold">{copy.grants}</h2>
          {detail.grants.length === 0 && <p>{copy.none}</p>}
          <ul>
            {detail.grants.map((grant) => (
              <li key={grant.id} className="grid gap-2">
                <p>
                  {copy.actions[grant.action]} · {copy.grantModes[grant.mode]}
                </p>
                <Button
                  variant="outline"
                  disabled={revoke.pending}
                  onClick={() => void revoke.run(() => client.revokeGrant(grant.id))}
                >
                  {copy.revoke}
                </Button>
              </li>
            ))}
          </ul>
          <MutationStatus mutation={revoke} />
        </section>
      )}
    </aside>
  );
}
