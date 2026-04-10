import { fireEvent, render, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TaskConfigForm, type TaskConfigRuntimeAdapter } from "@/components/schedule/task-config-form";

const OPENCLAW_RUNTIME_ADAPTER: TaskConfigRuntimeAdapter = {
  key: "openclaw",
  label: "openclaw",
  spec: {
    adapterKey: "openclaw",
    version: "openclaw-legacy-v1",
    fields: [
      { key: "model", path: "model", label: "Model", kind: "text", constraints: { maxLength: 200 } },
      { key: "prompt", path: "prompt", label: "Prompt / instructions", kind: "textarea", constraints: { maxLength: 20000 } },
    ],
    runnability: { requiredPaths: ["model", "prompt"] },
  },
};

const RESEARCH_RUNTIME_ADAPTER: TaskConfigRuntimeAdapter = {
  key: "research",
  label: "research",
  spec: {
    adapterKey: "research",
    version: "research-v1",
    fields: [
      { key: "prompt", path: "prompt", label: "Research brief", kind: "textarea", constraints: { maxLength: 20000 } },
      {
        key: "depth",
        path: "depth",
        label: "Research depth",
        kind: "select",
        defaultValue: "standard",
        options: [
          { label: "Quick", value: "quick" },
          { label: "Standard", value: "standard" },
          { label: "Deep", value: "deep" },
        ],
      },
    ],
    runnability: { requiredPaths: ["prompt"] },
  },
};

describe("TaskConfigForm", () => {
  it("switches adapters without changing the form skeleton", async () => {
    const onSubmitAction = vi.fn().mockResolvedValue(undefined);

    const { container } = render(
      <TaskConfigForm
        runtimeAdapters={[OPENCLAW_RUNTIME_ADAPTER, RESEARCH_RUNTIME_ADAPTER]}
        defaultRuntimeAdapterKey="openclaw"
        initialValues={{
          title: "Investigate schedule drift",
          runtimeAdapterKey: "openclaw",
          runtimeInput: {
            model: "gpt-5.4",
            prompt: "Investigate why tasks drift across the day",
          },
        }}
        submitLabel="Save"
        pendingLabel="Saving"
        onSubmitAction={onSubmitAction}
      />,
    );
    const formScope = within(container);

    expect(formScope.getByLabelText("Model")).toBeInTheDocument();
    fireEvent.change(formScope.getByLabelText("Adapter"), { target: { value: "research" } });

    expect(formScope.queryByLabelText("Model")).not.toBeInTheDocument();

    const researchBrief = formScope.getByLabelText("Research brief");
    expect(researchBrief).toHaveValue("Investigate why tasks drift across the day");

    fireEvent.change(researchBrief, { target: { value: "Investigate why tasks drift after adapter switches" } });
    fireEvent.click(formScope.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(onSubmitAction).toHaveBeenCalledWith({
        title: "Investigate schedule drift",
        description: "",
        priority: "Medium",
        dueAt: null,
        runtimeAdapterKey: "research",
        runtimeInputVersion: "research-v1",
        runtimeInput: {
          prompt: "Investigate why tasks drift after adapter switches",
          depth: "standard",
        },
        runtimeModel: null,
        prompt: "Investigate why tasks drift after adapter switches",
        runtimeConfig: null,
      });
    });
  });

  it("does not make persisted default-valued fields explicit when reopening a saved task", async () => {
    const onSubmitAction = vi.fn().mockResolvedValue(undefined);

    const { container } = render(
      <TaskConfigForm
        runtimeAdapters={[RESEARCH_RUNTIME_ADAPTER]}
        defaultRuntimeAdapterKey="research"
        initialValues={{
          title: "Reopen research task",
          runtimeAdapterKey: "research",
          runtimeInput: {
            prompt: "Investigate the last failed rollout",
            depth: "standard",
          },
        }}
        submitLabel="Save"
        pendingLabel="Saving"
        onSubmitAction={onSubmitAction}
      />,
    );
    const formScope = within(container);

    expect(formScope.getByLabelText("Research depth")).toHaveValue("standard");
    fireEvent.click(formScope.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(onSubmitAction).toHaveBeenCalledWith({
        title: "Reopen research task",
        description: "",
        priority: "Medium",
        dueAt: null,
        runtimeAdapterKey: "research",
        runtimeInputVersion: "research-v1",
        runtimeInput: {
          prompt: "Investigate the last failed rollout",
          depth: "standard",
        },
        runtimeModel: null,
        prompt: "Investigate the last failed rollout",
        runtimeConfig: null,
      });
    });
  });
});
