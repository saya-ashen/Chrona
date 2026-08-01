import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join } from "node:path";
import { AcpProviderClient, type AcpDiagnostics, type AcpProviderOptions } from "@chrona/acp-provider";
import type { AgentProviderClient, CancelRunInput, CreateSessionInput, GetRunInput, HealthCheckInput, ProviderCapabilities, StartRunInput, StreamRunInput } from "@chrona/providers-foundation";
import { codexAcpConfig, type CodexProviderConfig } from "./types";
type SQLiteDatabase = {
  query<T>(sql: string): { all(): T[] };
  close(): void;
};

const require = createRequire(import.meta.url);
const bunSqliteModule = "bun" + ":sqlite";

export type CodexProviderOptions = {
  config?: CodexProviderConfig;
  acp?: Omit<AcpProviderOptions, "config">;
};

export class CodexProviderClient implements AgentProviderClient {
  readonly provider = "codex";
  private readonly acp: AcpProviderClient;

  constructor(opts: CodexProviderOptions = {}) {
    const config = opts.config ?? {};
    this.acp = new AcpProviderClient({
      ...(opts.acp ?? {}),
      config: codexAcpConfig(config),
      diagnostics: opts.acp?.diagnostics ?? new CodexLogDiagnostics(config),
    });
  }

  async getCapabilities(): Promise<ProviderCapabilities> {
    const inherited = await this.acp.getCapabilities();
    return {
      ...inherited,
      actionInvocation: "external_control_plane",
      startIdempotency: "unsupported",
      lookupByClientOperationId: false,
    };
  }

  checkHealth(input?: HealthCheckInput) {
    return this.acp.checkHealth(input);
  }

  createSession(input?: CreateSessionInput) {
    return this.acp.createSession(input);
  }

  startRun(input: StartRunInput) {
    return this.acp.startRun(input);
  }

  streamRun(input: StreamRunInput) {
    return this.acp.streamRun(input);
  }

  getRun(input: GetRunInput) {
    return this.acp.getRun(input);
  }

  cancelRun(input: CancelRunInput) {
    return this.acp.cancelRun(input);
  }
}

class CodexLogDiagnostics implements AcpDiagnostics {
  private readonly configDirectory?: string;

  constructor(config: CodexProviderConfig) {
    this.configDirectory = config.configDirectory?.trim();
  }

  details(): string {
    const dbPath = this.logsPath();
    if (!existsSync(dbPath)) return "";
    let db: SQLiteDatabase | undefined;
    try {
      const { Database } = require(bunSqliteModule) as {
        Database: new (path: string, options: { readonly: boolean }) => SQLiteDatabase;
      };
      db = new Database(dbPath, { readonly: true });
      const rows = db.query<{ body: string }>(`
        SELECT feedback_log_body AS body
        FROM logs
        WHERE feedback_log_body LIKE '%Request completed method=POST url=% status=%'
        ORDER BY id DESC
        LIMIT 20
      `).all();
      return rows.map((row) => row.body).filter((body) => body.includes("/responses") || body.includes("/chat/completions")).slice(0, 5).join("\n");
    } catch {
      return "";
    } finally {
      db?.close();
    }
  }

  private logsPath() {
    return join(this.configDirectory || join(homedir(), ".codex"), "logs_2.sqlite");
  }
}
