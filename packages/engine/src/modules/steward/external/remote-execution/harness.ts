/** Offline protocol fixture, never imported by the application entry. It implements
 * only the native carrier used by these tests, with real SQLite receipts and an
 * independent signature verifier. It is not an alternative Run scheduler. */
import { Database } from "bun:sqlite";
import { createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import { check, canonical, nativeDigest, validate, type Packet, type Target } from "./contracts";
import type { CarrierRequest } from "./kernel-port";

const seed = Buffer.from("6a".repeat(32), "hex");
const privateKey = createPrivateKey({ key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), seed]), type: "pkcs8", format: "der" });
export const publicKey = createPublicKey(privateKey).export({ type: "spki", format: "pem" }).toString();
export function signedStop(statement: Record<string, unknown>) {
  return { statement, signature: sign(null, Buffer.from(nativeDigest(statement), "hex"), privateKey).toString("base64") };
}
export class TrustedKernel {
  readonly db: Database;
  constructor(file: string) {
    this.db = new Database(file, { create: true, strict: true });
    this.db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS offers(id TEXT PRIMARY KEY,packet TEXT NOT NULL,accepted INTEGER NOT NULL DEFAULT 0,process TEXT,source INTEGER NOT NULL DEFAULT 0,final TEXT,settled INTEGER NOT NULL DEFAULT 0); CREATE TABLE IF NOT EXISTS receipts(delivery TEXT NOT NULL,operation TEXT NOT NULL,key TEXT NOT NULL,digest TEXT NOT NULL,result TEXT NOT NULL,PRIMARY KEY(delivery,operation,key));");
  }
  offer(packet: Packet) {
    validate("packet", packet);
    const old = this.db.query<{ packet: string }, [string]>("SELECT packet FROM offers WHERE id=?").get(packet.target.deliveryId);
    if (old) check(canonical(JSON.parse(old.packet)) === canonical(packet), "conflict");
    else this.db.query("INSERT INTO offers(id,packet) VALUES (?,?)").run(packet.target.deliveryId, canonical(packet));
  }
  cleanup(deliveryId: string, command: Extract<Packet["controls"][number], { operation: "cleanup" }>) {
    const row = this.db.query<{ packet: string; settled: number }, [string]>("SELECT packet,settled FROM offers WHERE id=?").get(deliveryId);
    check(row?.settled, "conflict");
    const packet = JSON.parse(row.packet) as Packet;
    this.db.query("UPDATE offers SET packet=? WHERE id=?").run(canonical({ ...packet, launchable: false, controls: [...packet.controls, command] }), deliveryId);
  }
  call = async (target: string, args: Record<string, unknown>) => {
    check(target === "runtime-callback.remote-delivery", "forbidden");
    const request = args as unknown as CarrierRequest;
    if (request.operation === "poll") return { deliveries: this.db.query<{ packet: string; settled: number; id: string }, []>("SELECT id,packet,settled FROM offers ORDER BY id").all().filter(row => !row.settled || (JSON.parse(row.packet) as Packet).controls.some(c => c.operation === "cleanup" && !this.db.query("SELECT 1 FROM receipts WHERE delivery=? AND operation='cleanup-report' AND json_extract(result,'$.operationKey')=?").get(row.id, c.requestKey))).slice(0, request.limit).map(r => JSON.parse(r.packet)) };
    if (request.operation === "revoke" || request.operation === "reconcile") return this.db.transaction(() => {
      const id = `subject:${request.subjectId}:${request.epoch}:${request.keyId}`;
      const content = nativeDigest(args), old = this.db.query<{ digest: string; result: string }, [string,string,string]>("SELECT digest,result FROM receipts WHERE delivery=? AND operation=? AND key=?").get(id,request.operation,request.key);
      if (old) { check(old.digest === content,"conflict"); return JSON.parse(old.result); }
      const result = request.operation === "revoke" ? { revoked: true, subjectId: request.subjectId, epoch: request.epoch, keyId: request.keyId } : { recorded: true, reconciled: request.complete, missing: [], launchable: request.complete && !this.db.query("SELECT 1 FROM receipts WHERE delivery=? AND operation='revoke'").get(id) };
      if (request.operation === "revoke") for (const row of this.db.query<{id:string;packet:string},[]>("SELECT id,packet FROM offers").all()) {
        const packet = JSON.parse(row.packet) as Packet;
        if (packet.target.subjectId === request.subjectId && packet.target.epoch === request.epoch) this.db.query("UPDATE offers SET packet=? WHERE id=?").run(canonical({...packet,launchable:false}),row.id);
      }
      this.db.query("INSERT INTO receipts VALUES (?,?,?,?,?)").run(id,request.operation,request.key,content,canonical(result)); return result;
    }).immediate();
    return this.db.transaction(() => {
      const row = this.db.query<{ packet: string; accepted: number; process: string | null; source: number; final: string | null; settled: number }, [string]>("SELECT * FROM offers WHERE id=?").get(request.target.deliveryId);
      check(row, "not_found"); const packet = JSON.parse(row.packet) as Packet;
      check(canonical(packet.target) === canonical(request.target), "conflict");
      const payload = { ...args }; delete payload.key;
      const content = nativeDigest(payload), prior = this.db.query<{ digest: string; result: string }, [string, string, string]>("SELECT digest,result FROM receipts WHERE delivery=? AND operation=? AND key=?").get(request.target.deliveryId, request.operation, request.key);
      if (prior) { check(prior.digest === content, "conflict"); return JSON.parse(prior.result); }
      const id = request.target.deliveryId; let result: Record<string, unknown>;
      switch (request.operation) {
        case "cancel": {
          const control = { requestKey: request.key, operation: "control" as const, payload: { operation: "cancel" as const } };
          this.db.query("UPDATE offers SET packet=? WHERE id=?").run(canonical({...packet,launchable:false,controls:[...packet.controls,control]}),id);
          result = {controlKey:request.key}; break;
        }
        case "model": result = {status:"completed",reservationId:`reservation:${request.key}`,result:{text:"fixture model result",inputTokens:2,outputTokens:3}};break;
        case "cleanup-report": {
          validate("cleanup-receipt", request.report);
          const control = packet.controls.find(c => c.operation === "cleanup" && c.requestKey === request.controlKey);
          check(row.settled && control?.operation === "cleanup", "conflict");
          const command = control.payload, report = request.report;
          check(report.workId === packet.target.workId && report.workspaceRef === packet.launch.workspaceRef && report.operationKey === command.commandKey && report.state !== "pending", "conflict");
          if (command.op === "preview") check(report.state !== "removed" && (report.state !== "retained" || typeof report.previewDigest === "string"), "conflict");
          else check(command.previewDigest === report.previewDigest, "conflict");
          result = report; break;
        }
        case "accept": check(packet.launchable, "conflict"); this.db.query("UPDATE offers SET accepted=1 WHERE id=?").run(id); result = { accepted: true, target: request.target }; break;
        case "started": validate("native-started", request.processIdentity); check(row.accepted && (!row.process || row.process === canonical(request.processIdentity)), "conflict"); this.db.query("UPDATE offers SET process=? WHERE id=?").run(canonical(request.processIdentity), id); result = { started: true, target: request.target }; break;
        case "source": {
          validate("native-source", request.records); check(row.accepted && !row.final, "conflict"); let through = row.source;
          for (const record of request.records as { sequence: number }[]) check(record.sequence === ++through, "conflict");
          this.db.query("UPDATE offers SET source=? WHERE id=?").run(through, id); result = { throughSourceSeq: through }; break;
        }
        case "final": validate("native-final", request.final); check(request.final.throughSourceSeq === row.source && canonical(request.final.baseline) === canonical(packet.launch.target.baseline) && (!row.final || row.final === canonical(request.final)), "conflict"); this.db.query("UPDATE offers SET final=? WHERE id=?").run(canonical(request.final), id); result = { committed: true, finalDigest: nativeDigest(request.final) }; break;
        case "stop": {
          validate("native-stop", request.proof); const statement = request.proof.statement as { target: Target; kind: string; processIdentity: unknown; finalDigest: string; sourceThrough: number };
          check(row.final && statement.finalDigest === nativeDigest(JSON.parse(row.final)) && statement.sourceThrough === row.source && canonical(statement.target) === canonical(packet.target), "conflict");
          check(statement.kind === "exited" ? row.process && row.process === canonical(statement.processIdentity) : !row.process && statement.processIdentity === null, "conflict");
          check(verify(null, Buffer.from(nativeDigest(statement), "hex"), publicKey, Buffer.from(String(request.proof.signature), "base64")), "forbidden");
          this.db.query("UPDATE offers SET settled=1 WHERE id=?").run(id); result = { settled: true, finalDigest: statement.finalDigest, stopDigest: nativeDigest(request.proof) }; break;
        }
        case "acknowledge": check(packet.controls.some(c => c.requestKey === request.controlKey), "conflict"); result = { acknowledged: true, controlKey: request.controlKey }; break;
      }
      this.db.query("INSERT INTO receipts VALUES (?,?,?,?,?)").run(id, request.operation, request.key, content, canonical(result)); return result;
    }).immediate();
  };
  close() { this.db.close(); }
}
