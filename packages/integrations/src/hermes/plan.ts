import type {
  HermesCheckKey,
  HermesDiagnostics,
  HermesSetupAction,
  HermesSetupActionKey,
  HermesSetupPlan,
} from "./types.js";

type HermesCheckRule = {
  action?: HermesSetupActionKey;
  kind: "automatic" | "manual";
  localOnly?: boolean;
  manualMessage: string;
};

const HERMES_CHECK_RULES: Record<HermesCheckKey, HermesCheckRule> = {
  baseUrlScope: {
    kind: "manual",
    manualMessage: "Use http://127.0.0.1:8642 for local Hermes, or configure remote Hermes manually.",
  },
  hermesCli: {
    action: "manualInstallHermes",
    kind: "manual",
    localOnly: true,
    manualMessage: "Install Hermes locally, then rerun setup.",
  },
  chronaPluginInstalled: {
    action: "installPlugin",
    kind: "automatic",
    localOnly: true,
    manualMessage: "Run chrona hermes plugin install on the Hermes machine.",
  },
  chronaPluginVersion: {
    action: "updatePlugin",
    kind: "automatic",
    localOnly: true,
    manualMessage: "Update the Chrona Hermes plugin on the Hermes machine.",
  },
  chronaPluginMcpUrl: {
    action: "updatePluginConfig",
    kind: "automatic",
    localOnly: true,
    manualMessage: "Configure the Chrona Hermes plugin MCP URL to point at this Chrona server.",
  },
  hermesEnvFile: {
    action: "writeApiEnv",
    kind: "automatic",
    localOnly: true,
    manualMessage: "Add API_SERVER_ENABLED=true and API_SERVER_KEY=<Chrona key> to ~/.hermes/.env.",
  },
  apiServerReachable: {
    action: "restartHermes",
    kind: "manual",
    manualMessage: "Start or restart Hermes after enabling the API server.",
  },
  apiKey: {
    action: "manualFixApiKey",
    kind: "manual",
    manualMessage: "Set API_SERVER_KEY to match the API key configured in Chrona.",
  },
  apiCapabilities: {
    action: "manualUpgradeHermes",
    kind: "manual",
    manualMessage: "Enable the Hermes API server feature or upgrade Hermes to a version exposing Chrona-required run capabilities.",
  },
};

function shouldSkipStatus(status: string): boolean {
  return status === "ok" || status === "skipped";
}

function pushAction(actions: HermesSetupAction[], action: HermesSetupAction): void {
  if (actions.some((existing) => existing.key === action.key && existing.reason === action.reason)) return;
  actions.push(action);
}

function requiresManualRestart(actionKey: HermesSetupActionKey): boolean {
  return actionKey === "installPlugin" || actionKey === "updatePlugin" || actionKey === "writeApiEnv";
}

function addRestartActionIfNeeded(actions: HermesSetupAction[]): void {
  if (!actions.some((action) => requiresManualRestart(action.key))) return;
  pushAction(actions, {
    key: "restartHermes",
    kind: "manual",
    required: true,
    reason: "Restart Hermes manually after plugin or API environment changes. Chrona cannot infer how your Hermes gateway was started.",
  });
}

function shouldPlanCheck(check: HermesDiagnostics["checks"][number]): boolean {
  if (shouldSkipStatus(check.status)) return false;
  if (check.status !== "unknown") return true;
  return check.key !== "apiCapabilities" && check.key !== "apiKey";
}

function getActionForCheck(
  checkKey: HermesCheckKey,
  checkMessage: string,
  diagnostics: HermesDiagnostics,
): HermesSetupAction {
  const rule = HERMES_CHECK_RULES[checkKey];
  const canRunAutomatic = rule.kind === "automatic" && diagnostics.mode === "local";
  const actionKey = canRunAutomatic
    ? rule.action
    : rule.action && rule.kind === "manual"
      ? rule.action
      : "manualRemoteConfig";

  return {
    key: actionKey ?? "manualRemoteConfig",
    kind: canRunAutomatic ? "automatic" : "manual",
    required: true,
    blocked: rule.localOnly === true && diagnostics.mode !== "local",
    reason: canRunAutomatic ? checkMessage : rule.manualMessage,
  };
}

function getPlanSummary(automaticCount: number, manualCount: number): string {
  if (automaticCount > 0) return `${automaticCount} local action(s) can be automated; ${manualCount} manual action(s) remain.`;
  if (manualCount > 0) return `${manualCount} manual action(s) required.`;
  return "Hermes integration looks ready.";
}

export function planHermesSetup(diagnostics: HermesDiagnostics): HermesSetupPlan {
  const actions: HermesSetupAction[] = [];

  for (const check of diagnostics.checks) {
    if (shouldPlanCheck(check)) pushAction(actions, getActionForCheck(check.key, check.message, diagnostics));
  }
  addRestartActionIfNeeded(actions);

  const automaticCount = actions.filter((action) => action.kind === "automatic" && !action.blocked).length;
  const manualCount = actions.filter((action) => action.kind === "manual" || action.blocked).length;

  return {
    canRunAutomatically: automaticCount > 0,
    actions,
    summary: getPlanSummary(automaticCount, manualCount),
  };
}
