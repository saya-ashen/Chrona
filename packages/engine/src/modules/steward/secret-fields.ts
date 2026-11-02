import { z } from "zod";
import type { SecretSpec } from "@chrona/contracts/steward";

/** Written by the kernel (v2-30 §4), never typed on the page. */
export const kernelField = (field: string) => /^(refreshToken|scope)(_|$)/.test(field) || field === "oauthManaged";

/**
 * v2-16 §2.1: what the page needs to ask for one credential — the declared fields, the user-named extras and the
 * authorized OAuth accounts, with which are saved. Field names only: values never leave the store.
 */
export function secretView(declared: string | SecretSpec, saved: Record<string, string> | null) {
  const spec: SecretSpec = typeof declared === "string" ? { name: declared, fields: [] } : declared;
  const names = Object.keys(saved ?? {}), oauth = spec.oauth;
  const defaults: SecretSpec["fields"] = oauth ? [{ name: "clientId", label: "Client ID", plain: true }, { name: "clientSecret", label: "Client secret", optional: true }] : [];
  const fields = [...spec.fields, ...defaults.filter(field => !spec.fields.some(own => own.name === field.name))];
  const extras = names.filter(name => !kernelField(name) && !fields.some(field => field.name === name));
  return {
    label: spec.label ?? null, description: spec.description ?? null,
    fields: fields.map(field => ({ name: field.name, label: field.label, description: field.description ?? null, optional: !!field.optional, plain: !!field.plain, saved: names.includes(field.name) })),
    extraFields: spec.extraFields ? { label: spec.extraFields.label, valueLabel: spec.extraFields.valueLabel, description: spec.extraFields.description ?? null, saved: extras } : null,
    // Without a declaration the page cannot tell fields apart: it lists every saved name.
    savedFields: typeof declared === "string" ? names.filter(name => !kernelField(name)) : null,
    oauth: oauth ? { provider: oauth.provider, scopes: oauth.scopes, accounts: !!oauth.accounts,
      authorized: names.filter(name => /^refreshToken(_|$)/.test(name)).map(name => name === "refreshToken" ? "" : name.slice("refreshToken_".length)) } : null,
  };
}
export const secretViewSchema = z.object({
  label: z.string().nullable(), description: z.string().nullable(),
  fields: z.array(z.object({ name: z.string(), label: z.string(), description: z.string().nullable(), optional: z.boolean(), plain: z.boolean(), saved: z.boolean() })),
  extraFields: z.object({ label: z.string(), valueLabel: z.string(), description: z.string().nullable(), saved: z.array(z.string()) }).nullable(),
  savedFields: z.array(z.string()).nullable(),
  oauth: z.object({ provider: z.string(), scopes: z.array(z.string()), accounts: z.boolean(), authorized: z.array(z.string()) }).nullable(),
});
