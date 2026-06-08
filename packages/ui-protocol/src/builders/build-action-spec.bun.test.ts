import { describe, expect, it } from "bun:test";
import { buildActionSpec } from "./build-action-spec";

describe("buildActionSpec", () => {
  it("single checkpoint action: Select field + Submit button bound to submit-checkpoint", () => {
    const spec = buildActionSpec({
      fields: [{ key: "decision", label: "Decision", value: "", control: "approval", required: true }],
      actions: [{ id: "approve", label: "Accept", kind: "approve", checkpointId: "cp-1", checkpointAction: "approve_result" }],
      nodeNextAction: "Approve or reject to continue.",
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
    expect((field.props as Record<string, unknown>).checks).toEqual([{ type: "required" }]);

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
      actions: [{
        id: "task-primary:retry_sync:node-1",
        label: "Retry Run",
        kind: "retry",
        emphasis: "danger",
        executionAction: { action: "retry_node", nodeId: "node-1" },
      }],
    });

    const submit = spec.elements.submit;
    expect((submit.props as Record<string, unknown>).label).toBe("Send Retry Run");
    expect((submit.props as Record<string, unknown>).variant).toBe("danger");
    const press = (submit.on as Record<string, unknown>)?.press as Record<string, unknown>;
    expect(press?.action).toBe("dispatch-execution");
    expect((press?.params as Record<string, unknown>)?.actionId).toBe("task-primary:retry_sync:node-1");
  });

  it("textarea field maps to Textarea element", () => {
    const spec = buildActionSpec({
      fields: [{ key: "notes", label: "Notes", value: "", control: "textarea" }],
      actions: [{ id: "a", label: "submit", kind: "input", checkpointAction: "submit_input" }],
    });

    expect(spec.elements["field:notes"].type).toBe("Textarea");
    expect((spec.elements["field:notes"].props as Record<string, unknown>).value).toEqual({ $bindState: "/notes" });
  });

  it("readonly/submitted: Alert + disabled fields bound via $bindState, no submit button, state seeded", () => {
    const spec = buildActionSpec({
      fields: [
        { key: "city", label: "City", value: "", required: true },
        { key: "extra", label: "Notes", value: "", control: "textarea" },
      ],
      actions: [{ id: "a", label: "input", kind: "input", checkpointAction: "submit_input" }],
      submittedValues: { city: "Beijing", extra: "None" },
      isReadOnly: true,
    });

    expect(spec.elements["submitted-alert"].type).toBe("Alert");
    expect((spec.elements["submitted-alert"].props as Record<string, unknown>).type).toBe("info");

    // Readonly fields use $bindState so the shadcn renderer picks up the seeded state value
    expect((spec.elements["field:city"].props as Record<string, unknown>).value).toEqual({ $bindState: "/city" });
    expect((spec.elements["field:city"].props as Record<string, unknown>).disabled).toBe(true);
    expect((spec.elements["field:extra"].props as Record<string, unknown>).value).toEqual({ $bindState: "/extra" });
    expect((spec.elements["field:extra"].props as Record<string, unknown>).disabled).toBe(true);

    expect(spec.elements.submit).toBeUndefined();
    // State is seeded with submitted values so $bindState references resolve correctly
    expect(spec.state?.["city"]).toBe("Beijing");
    expect(spec.state?.["extra"]).toBe("None");
  });

  it("no actions: fields rendered, no submit button", () => {
    const spec = buildActionSpec({
      fields: [{ key: "msg", label: "Message", value: "hello" }],
      actions: [],
    });

    expect(spec.elements["field:msg"].type).toBe("Input");
    expect(spec.state?.["msg"]).toBe("hello");
    expect(spec.elements.submit).toBeUndefined();
  });

  it("disabledReason: warning Alert + disabled submit button", () => {
    const spec = buildActionSpec({
      fields: [{ key: "decision", label: "Decision", value: "", control: "approval" }],
      actions: [{ id: "approve", label: "Accept", kind: "approve", checkpointAction: "approve_result" }],
      disabledReason: "Action blocked: no active checkpoint.",
    });

    expect(spec.elements["disabled-alert"].type).toBe("Alert");
    expect((spec.elements["disabled-alert"].props as Record<string, unknown>).title).toBe("Action blocked: no active checkpoint.");
    expect((spec.elements["disabled-alert"].props as Record<string, unknown>).type).toBe("warning");
    expect((spec.elements.submit.props as Record<string, unknown>).disabled).toBe(true);
    expect(spec.elements.root.children).toContain("disabled-alert");
  });

  it("multiple checkpoint actions: action Select + dynamic checkpointAction param", () => {
    const spec = buildActionSpec({
      fields: [],
      actions: [
        { id: "a1", label: "Approve", kind: "approve", emphasis: "primary", checkpointAction: "approve_result" },
        { id: "a2", label: "Reject", kind: "approve", checkpointAction: "reject_result" },
      ],
    });

    const actionSelect = spec.elements["action-select"];
    expect(actionSelect.type).toBe("Select");
    expect((actionSelect.props as Record<string, unknown>).options).toEqual(["approve_result", "reject_result"]);
    expect((actionSelect.props as Record<string, unknown>).value).toEqual({ $bindState: "/__checkpointAction" });

    expect(spec.state?.["__checkpointAction"]).toBe("approve_result");

    const press = (spec.elements.submit.on as Record<string, unknown>)?.press as Record<string, unknown>;
    expect((press?.params as Record<string, unknown>)?.checkpointAction).toEqual({ $state: "/__checkpointAction" });
  });

  it("disabledButton: disables submit button without showing a warning Alert", () => {
    const spec = buildActionSpec({
      fields: [{ key: "city", label: "City", value: "" }],
      actions: [{ id: "submit", label: "input", kind: "input", checkpointAction: "submit_input" }],
      disabledButton: true,
    });

    expect((spec.elements.submit.props as Record<string, unknown>).disabled).toBe(true);
    expect(spec.elements["disabled-alert"]).toBeUndefined();

    const specEnabled = buildActionSpec({
      fields: [{ key: "city", label: "City", value: "Beijing" }],
      actions: [{ id: "submit", label: "input", kind: "input", checkpointAction: "submit_input" }],
      disabledButton: false,
    });
    expect((specEnabled.elements.submit.props as Record<string, unknown>).disabled).toBeUndefined();
  });

});
