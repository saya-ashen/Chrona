import { existsSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";

const SYSTEM_SID = "S-1-5-18";
const FULL_CONTROL = 2_032_127;

export type WindowsAclRule = {
  sid: string;
  accessType: string;
  rights: number;
  inherited: boolean;
};

export type WindowsAclAudit = {
  owner: string;
  currentUser: string;
  rules: WindowsAclRule[];
};

export type WindowsAclCommand = {
  command: string;
  args: string[];
};

/** Build the locale-independent icacls invocation used for Chrona-owned paths. */
export function buildWindowsPrivateAclCommand(path: string, currentUserSid: string, directory: boolean): WindowsAclCommand {
  const inheritance = directory ? "(OI)(CI)(F)" : "(F)";
  return {
    command: "icacls.exe",
    args: [
      path,
      "/inheritance:r",
      "/setowner", `*${currentUserSid}`,
      "/grant:r",
      `*${currentUserSid}:${inheritance}`,
      `*${SYSTEM_SID}:${inheritance}`,
    ],
  };
}

/** Parse the deliberately JSON-only PowerShell ACL audit output. Exported for cross-platform unit tests. */
export function parseWindowsAclAudit(output: string): WindowsAclAudit {
  const json = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .reverse()
    .find((line) => line.startsWith("{") && line.endsWith("}"));
  if (!json) throw new Error("Windows ACL audit produced no JSON result.");
  const parsed: unknown = JSON.parse(json);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Windows ACL audit returned an invalid result.");
  }
  const value = parsed as Record<string, unknown>;
  if (
    typeof value.owner !== "string"
    || typeof value.currentUser !== "string"
    || !Array.isArray(value.rules)
    || value.rules.some((rule) => {
      if (!rule || typeof rule !== "object" || Array.isArray(rule)) return true;
      const candidate = rule as Record<string, unknown>;
      return typeof candidate.sid !== "string"
        || typeof candidate.accessType !== "string"
        || typeof candidate.rights !== "number"
        || typeof candidate.inherited !== "boolean";
    })
  ) {
    throw new Error("Windows ACL audit returned an invalid result.");
  }
  return {
    owner: value.owner,
    currentUser: value.currentUser,
    rules: value.rules as WindowsAclRule[],
  };
}

export function windowsAclIsPrivate(audit: WindowsAclAudit): boolean {
  const allowed = new Set([audit.currentUser, SYSTEM_SID]);
  const userHasFullControl = audit.rules.some((rule) => rule.sid === audit.currentUser && rule.accessType === "Allow" && (rule.rights & FULL_CONTROL) === FULL_CONTROL);
  return audit.owner === audit.currentUser
    && userHasFullControl
    && audit.rules.length > 0
    && audit.rules.every((rule) => !rule.inherited && rule.accessType === "Allow" && allowed.has(rule.sid));
}

const ACL_AUDIT_SCRIPT = [
  "$p = $args[0]",
  "$identity = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value",
  "$acl = Get-Acl -LiteralPath $p -ErrorAction Stop",
  "$rules = @($acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]) | ForEach-Object { [pscustomobject]@{ sid = $_.IdentityReference.Value; accessType = $_.AccessControlType.ToString(); rights = [int]$_.FileSystemRights; inherited = $_.IsInherited } })",
  "$result = [pscustomobject]@{ owner = $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value; currentUser = $identity; rules = $rules }",
  "[Console]::Out.Write(($result | ConvertTo-Json -Compress -Depth 3))",
].join("; ");

function execute(command: string, args: string[]): { status: number | null; stdout: string; stderr: string; error?: Error } {
  const result = spawnSync(command, args, { encoding: "utf8", windowsHide: true });
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    error: result.error,
  };
}

function windowsAclAudit(path: string): WindowsAclAudit {
  const result = execute("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", ACL_AUDIT_SCRIPT, "--", path]);
  if (result.error || result.status !== 0) {
    throw new Error(`Chrona could not audit Windows owner-only ACLs for ${path}: ${result.stderr || result.error?.message || "PowerShell failed"}`);
  }
  return parseWindowsAclAudit(result.stdout);
}

/** Audits an existing path without changing an arbitrary user-selected ACL. */
export function assertWindowsPrivateStorage(path: string): void {
  const audit = windowsAclAudit(path);
  if (!windowsAclIsPrivate(audit)) {
    throw new Error(`Chrona requires owner-only Windows ACLs for ${path}. Existing custom paths are never rewritten; choose an empty Chrona directory or secure it for the current user and SYSTEM.`);
  }
}

/** Applies and verifies a private ACL for a path Chrona itself generated. */
export function secureWindowsGeneratedStorage(path: string, directory: boolean): void {
  const before = windowsAclAudit(path);
  const command = buildWindowsPrivateAclCommand(path, before.currentUser, directory);
  const result = execute(command.command, command.args);
  if (result.error || result.status !== 0) {
    throw new Error(`Chrona could not secure Windows owner-only ACLs for ${path}: ${result.stderr || result.error?.message || "icacls failed"}`);
  }
  assertWindowsPrivateStorage(path);
}

/** Create a Chrona-owned directory or audit an existing selected directory. */
export function ensureWindowsPrivateDirectory(path: string): void {
  const existed = existsSync(path);
  if (!existed) mkdirSync(path, { recursive: true });
  if (existed) assertWindowsPrivateStorage(path);
  else secureWindowsGeneratedStorage(path, true);
}
