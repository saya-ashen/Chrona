import { describe, expect, it } from "bun:test";
import { validateChronaSpec } from "../document/validate";
import { buildActionSpec } from "./build-action-spec";

describe("buildActionSpec", () => {
  it("preserves manual form guidance and placeholders", () => {
    const spec = buildActionSpec({
      fields: [{
        key: "result",
        label: "Result",
        description: "Record what happened.",
        placeholder: "Per-item results",
        value: "",
        control: "textarea",
        required: true,
      }],
      actions: [],
    });
    expect(spec.elements["field:result:description"]).toMatchObject({
      type: "Text",
      props: { text: "Record what happened." },
    });
    expect(spec.elements["field:result"]).toMatchObject({
      type: "Textarea",
      props: { placeholder: "Per-item results" },
    });
  });
  it("single checkpoint action: Select field + Submit button bound to submit-checkpoint", () => {
    const spec = buildActionSpec({
      fields: [{ key: "decision", label: "Decision", value: "", control: "approval", required: true }],
      actions: [{ id: "approve", label: "Accept", kind: "approval", checkpointAction: "approve_result" }],
      nodeNextAction: "Choose a result.",
    });

    expect(spec.root).toBe("root");
    expect(spec.elements.root.type).toBe("Stack");
    expect(spec.elements.root.children).toContain("field:decision");
    expect(spec.elements.root.children).toContain("submit");
    expect(spec.elements.root.children).toContain("guidance");

    const field = spec.elements["field:decision"];
    expect(field.type).toBe("Select");
    expect((field.props as Record<string, unknown>).options).toEqual(["Approve", "Reject", "Needs changes"]);
    expect((field.props as Record<string, unknown>).value).toEqual({ $bindState: "/decision" });
    expect((field.props as Record<string, unknown>).checks).toEqual([{ type: "required", message: "Decision is required" }]);

    const submit = spec.elements.submit;
    expect(submit.type).toBe("Button");
    expect((submit.props as Record<string, unknown>).label).toBe("Send Accept");
    const press = (submit.on as Record<string, unknown>)?.press as Record<string, unknown>;
    expect(press?.action).toBe("submit-checkpoint");
    const params = press?.params as Record<string, unknown>;
    expect(params?.checkpointAction).toBe("approve_result");
    expect(params?.values).toEqual({ $state: "/" });

    expect(spec.state?.["decision"]).toBe("");
  });

  it("execution action: Button bound to dispatch-execution with actionId", () => {
    const spec = buildActionSpec({
      fields: [],
      actions: [{ id: "retry", label: "Retry", kind: "execution", executionAction: { type: "retry" } }],
    });

    const submit = spec.elements.submit;
    const press = (submit.on as Record<string, unknown>)?.press as Record<string, unknown>;
    expect(press).toEqual({ action: "dispatch-execution", params: { actionId: "retry" } });
  });

  it("textarea field maps to Textarea element", () => {
    const spec = buildActionSpec({
      fields: [{ key: "notes", label: "Notes", value: "", control: "textarea" }],
      actions: [],
    });
    expect(spec.elements["field:notes"].type).toBe("Textarea");
  });

  it("readonly/submitted: Alert + disabled fields bound via $bindState, no submit button, state seeded", () => {
    const spec = buildActionSpec({
      fields: [{ key: "comment", label: "Comment", value: "", control: "text" }],
      actions: [{ id: "submit", label: "Submit", kind: "input" }],
      isReadOnly: true,
      submittedValues: { comment: "Already sent" },
    });

    expect(spec.elements["submitted-alert"].type).toBe("Alert");
    expect(spec.elements.submit).toBeUndefined();
    expect((spec.elements["field:comment"].props as Record<string, unknown>).disabled).toBe(true);
    expect(spec.state?.comment).toBe("Already sent");
  });

  it("no actions: fields rendered, no submit button", () => {
    const spec = buildActionSpec({ fields: [{ key: "title", label: "Title", value: "" }], actions: [] });
    expect(spec.elements["field:title"]).toBeDefined();
    expect(spec.elements.submit).toBeUndefined();
  });

  it("disabledReason: warning Alert + disabled submit button", () => {
    const spec = buildActionSpec({
      fields: [],
      actions: [{ id: "submit", label: "Submit", kind: "input" }],
      disabledReason: "Complete required fields",
    });
    expect((spec.elements["disabled-alert"].props as Record<string, unknown>).type).toBe("warning");
    expect((spec.elements.submit.props as Record<string, unknown>).disabled).toBe(true);
  });

  it("multiple checkpoint actions: action Select + dynamic checkpointAction param", () => {
    const spec = buildActionSpec({
      fields: [],
      actions: [
        { id: "approve", label: "Approve", kind: "approval", checkpointAction: "approve" },
        { id: "reject", label: "Reject", kind: "approval", checkpointAction: "reject" },
      ],
    });
    expect(spec.elements["action-select"].type).toBe("Select");
    const press = ((spec.elements.submit.on as Record<string, unknown>).press as Record<string, unknown>);
    expect((press.params as Record<string, unknown>).checkpointAction).toEqual({ $state: "/__checkpointAction" });
  });

  it("disabledButton: disables submit button without showing a warning Alert", () => {
    const spec = buildActionSpec({
      fields: [],
      actions: [{ id: "submit", label: "Submit", kind: "input" }],
      disabledButton: true,
    });
    expect((spec.elements.submit.props as Record<string, unknown>).disabled).toBe(true);
    expect(spec.elements["disabled-alert"]).toBeUndefined();
  });

  it("preserves multiple-choice and boolean state bindings", () => {
    const spec = buildActionSpec({
      fields: [
        { key: "tags", label: "Tags", value: [], control: "choice", selection: "multiple", options: ["a", "b"] },
        { key: "confirmed", label: "Confirmed", value: false, control: "boolean" },
      ],
      actions: [],
    });
    expect(spec.state).toMatchObject({ tags: [], confirmed: false });
    expect((spec.elements["field:tags"].props as Record<string, unknown>).selection).toBe("multiple");
    expect((spec.elements["field:confirmed"].props as Record<string, unknown>).checked).toEqual({ $bindState: "/confirmed" });
  });

  it("produces an action document that validates its dynamic bindings and action payload", () => {
    const result = validateChronaSpec(buildActionSpec({
      fields: [{ key: "comment", label: "Comment", value: "", required: true }],
      actions: [{ id: "approve", label: "Approve", kind: "approval", checkpointAction: "approve" }],
    }));

    expect(result).toMatchObject({ ok: true });
  });
});
