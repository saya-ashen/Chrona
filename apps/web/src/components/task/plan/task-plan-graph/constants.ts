import type { GraphCopy } from "./types";

export const AUTO_FULL_MODE_MIN_WIDTH = 820;
export const NODE_WIDTH = 216;
export const NODE_HEIGHT = 92;
export const LAYOUT_DIRECTION = "TB";
export const LAYOUT_PADDING = 32;
export const LAYOUT_NODE_SEP = 34;
export const LAYOUT_RANK_SEP = 88;
export const EDGE_OFFSET = 24;
export const MAX_VIEWPORT_HEIGHT = 620;
export const MIN_VIEWPORT_HEIGHT = 320;
export const SELECTED_NODE_Z_INDEX = 1000;

export const DEFAULT_GRAPH_COPY: GraphCopy = {
  ariaLabel: "任务计划图",
  openFullGraph: "查看完整图",
  compactTitle: "流程摘要",
  compactDescription: "按阶段和关键路径展示当前执行图。",
  fullTitle: "完整任务计划图",
  fullDescription: "展示执行路径、依赖关系和节点操作入口。",
  closeDialog: "关闭完整任务计划图",
  overviewNodes: "节点",
  overviewActive: "活跃",
  overviewAttention: "待处理",
  overviewDone: "已完成",
  overviewEstimate: "预计时长",
  focusTitle: "当前焦点路径",
  focusDescription: "优先展示当前节点、阻塞链路和下一步。",
  inspectorTitle: "节点详情",
  inspectorEmpty: "选择一个节点后查看目标、依赖和后续可操作项。",
  inspectorWhy: "Why It Matters",
  inspectorDependencies: "Dependencies",
  inspectorExecution: "Execution",
  inspectorOutcomes: "Outcomes",
  inspectorFields: "Interactive Fields",
  legendStates: "状态",
  legendEdges: "连线",
  detailObjective: "目标",
  detailPhase: "阶段",
  detailExecutionMode: "执行模式",
  detailPriority: "优先级",
  detailEstimatedDuration: "预计时长",
  detailLinkedTask: "关联任务",
  detailReadiness: "就绪状态",
  detailNextAction: "下一步",
  detailDependencies: "前置依赖",
  detailRequiredInfo: "所需信息",
  detailCompletionSummary: "完成摘要",
  statusIdle: "待开始",
  statusReady: "就绪",
  statusActive: "进行中",
  statusWaiting: "待处理",
  statusBlocked: "阻塞",
  statusDone: "已完成",
  statusSkipped: "已跳过",
  edgeSequential: "主流程",
  edgeDependency: "依赖",
  edgeBranch: "分支",
  edgeResume: "回流",
  nodeTypeTask: "任务",
  nodeTypeCheckpoint: "检查点",
  nodeTypeCondition: "条件判断",
  nodeTypeWait: "等待",
  intentExecution: "执行",
  intentApproval: "审批",
  intentInput: "输入",
  intentDecision: "决策",
  intentPause: "暂停",
};
