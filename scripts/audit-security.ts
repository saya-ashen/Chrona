import { readFileSync } from "node:fs";

type AuditAdvisory = {
  id: number | string;
  severity: string;
  url?: string;
  title?: string;
};

type AuditWaiver = {
  package: string;
  cve: string;
  unreachableEvidence: string;
  owner: string;
  expiresAt: string;
};

type AuditWaiverFile = {
  waivers: AuditWaiver[];
};

const waiverFile = new URL("../security/audit-waivers.json", import.meta.url);

function advisoryReference(advisory: AuditAdvisory) {
  const ghsa = advisory.url?.match(/GHSA-[a-z0-9-]+/i)?.[0];
  const cve = advisory.url?.match(/CVE-\d{4}-\d+/i)?.[0];
  return cve ?? ghsa ?? String(advisory.id);
}

function readWaivers(): AuditWaiver[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(waiverFile, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw new Error(`Invalid JSON in ${waiverFile.pathname}`);
  }

  if (
    !parsed ||
    typeof parsed !== "object" ||
    !Array.isArray((parsed as AuditWaiverFile).waivers)
  ) {
    throw new Error(`${waiverFile.pathname} must contain a waivers array`);
  }

  return (parsed as AuditWaiverFile).waivers.map((waiver, index) => {
    const {
      package: packageName,
      cve,
      unreachableEvidence,
      owner,
      expiresAt,
    } = waiver;
    if (
      typeof packageName !== "string" ||
      typeof cve !== "string" ||
      !/^(?:CVE-\d{4}-\d+|GHSA-[a-z0-9-]+)$/i.test(cve) ||
      typeof unreachableEvidence !== "string" ||
      !unreachableEvidence.trim() ||
      typeof owner !== "string" ||
      !owner.trim() ||
      typeof expiresAt !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(expiresAt) ||
      Number.isNaN(Date.parse(`${expiresAt}T00:00:00.000Z`))
    ) {
      throw new Error(
        `Waiver ${index + 1} requires package, CVE/GHSA cve, unreachableEvidence, owner, and a valid expiresAt (YYYY-MM-DD)`,
      );
    }
    if (Date.parse(`${expiresAt}T00:00:00.000Z`) <= Date.now()) {
      throw new Error(
        `Waiver ${index + 1} for ${packageName} expired on ${expiresAt}`,
      );
    }
    return waiver;
  });
}

const audit = Bun.spawnSync(["bun", "audit", "--json"], {
  cwd: process.cwd(),
  stdout: "pipe",
  stderr: "pipe",
});

let results: Record<string, AuditAdvisory[]>;
try {
  results = JSON.parse(new TextDecoder().decode(audit.stdout));
} catch {
  throw new Error(
    `bun audit did not return JSON:\n${new TextDecoder().decode(audit.stderr)}`,
  );
}

const waivers = readWaivers();
const blockers = Object.entries(results).flatMap(([packageName, advisories]) =>
  advisories
    .filter(({ severity }) => severity === "high" || severity === "critical")
    .map((advisory) => ({
      packageName,
      advisory,
      reference: advisoryReference(advisory),
    }))
    .filter(
      ({ packageName, reference }) =>
        !waivers.some(
          (waiver) =>
            waiver.package === packageName &&
            waiver.cve.toLowerCase() === reference.toLowerCase(),
        ),
    ),
);

if (blockers.length) {
  console.error("Unwaived high/critical dependency advisories:");
  for (const { packageName, advisory, reference } of blockers) {
    console.error(
      `- ${packageName}: ${reference} (${advisory.severity})${advisory.title ? ` — ${advisory.title}` : ""}`,
    );
  }
  process.exit(1);
}

console.log(
  "Dependency audit gate passed: no unwaived high/critical advisories.",
);
