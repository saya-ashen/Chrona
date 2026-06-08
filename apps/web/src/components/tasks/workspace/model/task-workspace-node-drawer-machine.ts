export type NodeDrawerSize = "collapsed" | "expanded";

export type NodeDrawerMachineState = {
  size: NodeDrawerSize;
  shouldAutoOpen: boolean;
};

export function createNodeDrawerMachineState(): NodeDrawerMachineState {
  return { size: "collapsed", shouldAutoOpen: false };
}

export function recordNodeDrawerGraphClick(state: NodeDrawerMachineState): NodeDrawerMachineState {
  return { ...state, shouldAutoOpen: true };
}

export function recordNodeDrawerOutsideClick(state: NodeDrawerMachineState): NodeDrawerMachineState {
  return state.size === "collapsed" && !state.shouldAutoOpen
    ? state
    : { size: "collapsed", shouldAutoOpen: false };
}

export function applyNodeDrawerSelection(
  state: NodeDrawerMachineState,
  input: { hasNode: boolean },
): NodeDrawerMachineState {
  if (!input.hasNode) return { size: "collapsed", shouldAutoOpen: false };

  return {
    size: state.shouldAutoOpen && state.size === "collapsed" ? "expanded" : state.size,
    shouldAutoOpen: false,
  };
}

export function collapseNodeDrawer(state: NodeDrawerMachineState): NodeDrawerMachineState {
  return state.size === "collapsed" && !state.shouldAutoOpen
    ? state
    : { size: "collapsed", shouldAutoOpen: false };
}

export function expandNodeDrawer(state: NodeDrawerMachineState): NodeDrawerMachineState {
  return state.size === "expanded" && !state.shouldAutoOpen
    ? state
    : { size: "expanded", shouldAutoOpen: false };
}

export function setNodeDrawerSize(
  state: NodeDrawerMachineState,
  size: NodeDrawerSize,
): NodeDrawerMachineState {
  return size === "expanded" ? expandNodeDrawer(state) : collapseNodeDrawer(state);
}
