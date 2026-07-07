import { describe, expect, it } from "bun:test";
import { getPreferredLocale, hasLocale, resolveLocale } from "./locale";
import { localizeHref, stripLocalePrefix } from "./routing";

describe("locale resolution", () => {
  it("accepts supported locales and falls back to English", () => {
    expect(hasLocale("zh")).toBe(true);
    expect(hasLocale("fr")).toBe(false);
    expect(resolveLocale("zh")).toBe("zh");
    expect(resolveLocale("fr")).toBe("en");
    expect(resolveLocale(null)).toBe("en");
  });

  it("picks the first supported Accept-Language entry", () => {
    expect(getPreferredLocale("fr-CA, zh-CN;q=0.9, en;q=0.8")).toBe("zh");
    expect(getPreferredLocale("en-US,en;q=0.8,zh;q=0.7")).toBe("en");
    expect(getPreferredLocale("de-DE")).toBe("en");
  });
});

describe("localized routing", () => {
  it("strips existing locale prefixes", () => {
    expect(stripLocalePrefix("/en/tasks/1")).toBe("/tasks/1");
    expect(stripLocalePrefix("/zh")).toBe("/");
    expect(stripLocalePrefix("/tasks")).toBe("/tasks");
  });

  it("localizes internal links while preserving query and hash", () => {
    expect(localizeHref("zh", "/tasks/1?tab=plan#node")).toBe("/zh/tasks/1?tab=plan#node");
    expect(localizeHref("en", "/")).toBe("/en");
  });

  it("does not rewrite external, hash, query, or already-localized links", () => {
    expect(localizeHref("zh", "https://example.com/tasks")).toBe("https://example.com/tasks");
    expect(localizeHref("zh", "#top")).toBe("#top");
    expect(localizeHref("zh", "?panel=ai")).toBe("?panel=ai");
    expect(localizeHref("zh", "/en/tasks")).toBe("/en/tasks");
  });
});
