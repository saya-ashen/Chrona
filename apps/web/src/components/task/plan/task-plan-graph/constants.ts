import type { GraphCopy } from "./types";

export const AUTO_FULL_MODE_MIN_WIDTH = 720;
export const NODE_WIDTH = 180;
export const NODE_HEIGHT = 124;
export const EXPANDED_NODE_EXTRA_HEIGHT = 112;
export const EXPANDED_LINKED_NODE_EXTRA_HEIGHT = 52;
export const LAYOUT_DIRECTION = "TB";
export const LAYOUT_PADDING = 20;
export const LAYOUT_NODE_SEP = 8;
export const LAYOUT_RANK_SEP = 52;
export const EDGE_OFFSET = 18;
export const MAX_VIEWPORT_HEIGHT = 540;
export const MIN_VIEWPORT_HEIGHT = 260;
export const SELECTED_NODE_Z_INDEX = 1000;

export const DEFAULT_GRAPH_COPY: GraphCopy = {
  ariaLabel: "任务计划图",
  statusInProgress: "进行中",
  statusWaitingForChild: "子任务执行中",
  statusWaitingForUser: "等待你处理",
  statusWaitingForApproval: "等待审批",
  statusDone: "已完成",
  statusBlocked: "已阻塞",
  statusSkipped: "已跳过",
  statusPending: "待处理",
  edgeDependsOn: "依赖于",
  edgeSequential: "顺序执行",
  requiresHumanInput: "需要用户输入",
  detailType: "类型",
  detailExecutionMode: "执行模式",
  detailPriority: "优先级",
  detailEstimatedDuration: "预计时长",
  detailLinkedTask: "关联任务",
  detailDescription: "详细说明",
  detailCompletionSummary: "完成情况说明",
  detailExecutionClassification: "执行分类",
  detailReadiness: "就绪状态",
  detailNextAction: "建议下一步",
  detailDependencies: "前置依赖",
  detailRequiredInfo: "所需信息",
  nodeTypeTask: "任务",
  nodeTypeCheckpoint: "检查点",
  nodeTypeCondition: "条件判断",
  nodeTypeWait: "等待",
  badgeAuto: "自动",
  badgeManual: "手动",
  badgeAssist: "辅助",
  badgeAi: "AI",
  badgeUser: "用户",
  badgeSystem: "系统",
  badgeConfirm: "确认",
  badgeChoose: "选择",
  badgeInput: "输入",
  badgeEdit: "编辑",
  badgeApprove: "审批",
  badgeRequired: "必须",
  badgeOptional: "可选",
};
