import { describe, expect, it } from "vitest";
import { taskAutomationLabel } from "./task-list-page";
import en from "@chrona/i18n/messages/en.json";

const copy = en.pages.tasks;

describe("taskAutomationLabel", () => {
  it.each([
    [{ autoPlanGeneration: false, autoExecute: false }, copy.automationManual],
    [{ autoPlanGeneration: true, autoExecute: false }, copy.automationAutoPlan],
    [{ autoPlanGeneration: true, autoExecute: true }, copy.automationAutoComplete],
  ])("labels task automation mode", (task, expected) => {
    expect(taskAutomationLabel(task, copy)).toBe(expected);
  });
});
