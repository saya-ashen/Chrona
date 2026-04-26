declare module "dagre" {
  type GraphLabel = Record<string, unknown>;
  type EdgeLabel = Record<string, unknown>;

  interface LayoutNode {
    x: number;
    y: number;
    width: number;
    height: number;
  }

  class Graph {
    setDefaultEdgeLabel(fn: () => EdgeLabel): this;
    setGraph(label: GraphLabel): this;
    setNode(id: string, value: { width: number; height: number }): this;
    setEdge(source: string, target: string): this;
    node(id: string): LayoutNode | undefined;
  }

  export const graphlib: {
    Graph: typeof Graph;
  };

  export function layout(graph: Graph): void;

  const dagre: {
    graphlib: typeof graphlib;
    layout: typeof layout;
  };

  export default dagre;
}
