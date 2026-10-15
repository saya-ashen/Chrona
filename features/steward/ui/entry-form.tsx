import { InlineForm } from "./layout";
import { useI18n } from "@chrona/i18n";
import { Button, Input } from "@shared/ui";
import type { StewardClient } from "../model/client";
import { useEntryForm } from "../hooks/use-affairs";
import { MutationStatus } from "./resource-status";

export function EntryForm({
  client,
  affairId,
  kind,
  refresh,
}: {
  client: StewardClient;
  affairId: string;
  kind: "feedback" | "supplement";
  refresh: () => void;
}) {
  const { messages } = useI18n(),
    form = useEntryForm(client, affairId, kind, refresh);
  return (
    <InlineForm
      onSubmit={(e) => {
        e.preventDefault();
        void form.submit();
      }}
    >
      <label className="grid gap-2">
        {messages.steward.affairs[kind]}
        <Input
          value={form.text}
          onChange={(e) => form.setText(e.target.value)}
          maxLength={4000}
          disabled={form.pending}
        />
      </label>
      <Button className="w-fit" disabled={form.pending || !form.text.trim()}>
        {messages.steward.foundation.send}
      </Button>
      <MutationStatus mutation={form} />
    </InlineForm>
  );
}
