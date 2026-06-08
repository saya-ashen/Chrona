import { describe, expect, it } from "vitest";

import {
  applyNodeDrawerSelection,
  collapseNodeDrawer,
  createNodeDrawerMachineState,
  expandNodeDrawer,
  recordNodeDrawerGraphClick,
  recordNodeDrawerOutsideClick,
  setNodeDrawerSize,
} from "./task-workspace-node-drawer-machine";

describe("task workspace node drawer machine", () => {
  it("opens only for a graph click followed by node selection", () => {
    const initial = createNodeDrawerMachineState();

    const synchronizedSelection = applyNodeDrawerSelection(initial, { hasNode: true });
    expect(synchronizedSelection).toEqual({ size: "collapsed", shouldAutoOpen: false });

    const graphClick = recordNodeDrawerGraphClick(initial);
    expect(applyNodeDrawerSelection(graphClick, { hasNode: true })).toEqual({
      size: "expanded",
      shouldAutoOpen: false,
    });
  });

  it("keeps a collapsed drawer closed during graph refresh selection sync", () => {
    const opened = applyNodeDrawerSelection(recordNodeDrawerGraphClick(createNodeDrawerMachineState()), { hasNode: true });
    const closed = collapseNodeDrawer(opened);

    expect(applyNodeDrawerSelection(closed, { hasNode: true })).toEqual({
      size: "collapsed",
      shouldAutoOpen: false,
    });
  });

  it("collapses when selection is cleared", () => {
    expect(applyNodeDrawerSelection(expandNodeDrawer(createNodeDrawerMachineState()), { hasNode: false })).toEqual({
      size: "collapsed",
      shouldAutoOpen: false,
    });
  });

  it("collapses on outside click and reopens on explicit size request", () => {
    const opened = expandNodeDrawer(createNodeDrawerMachineState());

    expect(recordNodeDrawerOutsideClick(opened)).toEqual({ size: "collapsed", shouldAutoOpen: false });
    expect(setNodeDrawerSize(opened, "collapsed")).toEqual({ size: "collapsed", shouldAutoOpen: false });
    expect(setNodeDrawerSize(createNodeDrawerMachineState(), "expanded")).toEqual({ size: "expanded", shouldAutoOpen: false });
  });
});
