import { describe, expect, it } from "vitest";

import enMessages from "./messages/en.json";
import zhMessages from "./messages/zh.json";

type FlatMessages = Record<string, string | number | boolean | null>;

function flattenMessages(value: unknown, prefix = ""): FlatMessages {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { [prefix]: value as FlatMessages[string] };
  }

  return Object.entries(value).reduce<FlatMessages>((messages, [key, child]) => {
    const childPrefix = prefix ? `${prefix}.${key}` : key;
    return { ...messages, ...flattenMessages(child, childPrefix) };
  }, {});
}

const allowedIdenticalMessages = new Set([
  "nav.brandTitle",
  "locale.en",
  "locale.zh",
  "metadata.title",
  "components.assistantSurface.entry",
  "components.taskConfigForm.runtimeParamsPlaceholder",
  "components.taskPlanGraph.runOutputJsonTitle",
  "components.taskCreateDialog.recurrenceCustomLabel",
  "pages.aiClientsPage.hermes",
  "pages.dashboard.title",
  "components.taskWorkspace.followUpChronaLabel",
  "pages.goals.assetWorkbench.ai",
]);

describe("i18n messages", () => {
  it("keeps Chinese messages aligned with English keys", () => {
    const en = flattenMessages(enMessages);
    const zh = flattenMessages(zhMessages);

    expect(Object.keys(zh).sort()).toEqual(Object.keys(en).sort());
  });

  it("does not leave English copy in Chinese messages without explicit allow-list", () => {
    const en = flattenMessages(enMessages);
    const zh = flattenMessages(zhMessages);
    const identical = Object.entries(en)
      .filter(([key, value]) => typeof value === "string" && zh[key] === value && !allowedIdenticalMessages.has(key))
      .map(([key]) => key);

    expect(identical).toEqual([]);
  });
});
