import { useCallback, useState } from "react";
import type { StewardClient } from "../model/client";
import { useStewardMutation } from "./use-steward-mutation";
import { useStewardResource } from "./use-steward";

export function useConnector(client: StewardClient, id: string, refresh: () => void) {
  const load = useCallback((signal?: AbortSignal) => client.connectorItems(id, signal), [client, id]);
  const items = useStewardResource(load);
  const mutation = useStewardMutation(() => { refresh(); items.refresh(); });
  const [test, setTest] = useState<{ ok: boolean; error?: string } | null>(null);
  async function testConnection() {
    setTest(null);
    const result = await mutation.run(() => client.testConnector(id));
    if (result.ok) setTest(result.data);
  }
  return { items, mutation, test, testConnection };
}

export function useEmailConnector(client: StewardClient, refresh: () => void) {
  const [fields, setFields] = useState({ address: "", imapHost: "", imapPort: "993", smtpHost: "", smtpPort: "465", folders: "INBOX", affairId: "new", password: "" });
  const mutation = useStewardMutation(refresh);
  const update = (key: keyof typeof fields, value: string) => setFields(previous => ({ ...previous, [key]: value }));
  async function save(mailboxTitle: string) {
    // Retain a newly-created target on failure so retry cannot create duplicate affairs.
    await mutation.run(async () => {
      let affairId = fields.affairId;
      if (affairId === "new") {
        affairId = (await client.createAffair({ title: mailboxTitle })).id;
        update("affairId", affairId);
      }
      await client.createConnector({ kind: "email", label: fields.address, affairId,
        settings: { address: fields.address, imapHost: fields.imapHost, imapPort: Number(fields.imapPort), folders: fields.folders.split(",").map(folder => folder.trim()).filter(Boolean),
          ...(fields.smtpHost ? { smtpHost: fields.smtpHost, smtpPort: Number(fields.smtpPort) } : {}) },
        secret: { password: fields.password },
      });
      update("password", "");
    });
  }
  return { fields, update, mutation, save };
}
