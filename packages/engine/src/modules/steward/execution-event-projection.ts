import type { ExecutionEvent, ExecutionSnapshot } from "@chrona/contracts/steward";
import { providerText } from "@chrona/domain/steward/provider";

/** Display text only: never preserve URLs, auth headers or environment assignments. */
export function executionDisplayText(text: string, limit = 24_000): string {
  return providerText(text.replace(/\b[a-z][a-z\d+.-]*:\/\/[^\s<>"']+/gi, "[redacted]")
    .replace(/\b(?:authorization|proxy-authorization|cookie|set-cookie)\s*:[^\n]*/gi, "[redacted]")
    .replace(/\b[A-Za-z_][A-Za-z\d_]*=(?:"[^"\n]*"|'[^'\n]*'|[^\s;]+)/g, "[redacted]")
    .replace(/\b(?:password|api[_-]?key|access[_-]?token|secret|token|credential|passwd|pwd|client_secret)\s*[:=]\s*(?:"[^"\n]*"|'[^'\n]*'|[^\s,;]+)/gi, "[redacted]"), [], limit, true);
}

export function projectExecutionQuestion(question: ExecutionSnapshot["questions"][number]) {
  return { requestId: question.requestId, title: executionDisplayText(question.title, 200), method: question.method,
    options: question.options.map(option => executionDisplayText(option, 300)), expiresAt: question.expiresAt, status: question.status };
}

/** Input is the public normalized event, not a Provider/RPC envelope. Whitelist before redaction. */
export function projectExecutionEvent(event: ExecutionEvent): ExecutionEvent {
  const p = event.payload;
  let payload: ExecutionEvent["payload"];
  switch (p.type) {
    case "message": payload = { type: p.type, messageId: p.messageId, role: p.role, text: executionDisplayText(p.text), complete: p.complete }; break;
    case "text_delta": payload = { type: p.type, messageId: p.messageId, delta: executionDisplayText(p.delta) }; break;
    case "tool_started": {
      const display: { path?: string; command?: string } = {};
      if (["read", "edit", "write"].includes(p.tool) && p.display.path !== undefined) display.path = executionDisplayText(p.display.path, 1000);
      if (p.tool === "bash" && p.display.command !== undefined) display.command = executionDisplayText(p.display.command, 1000);
      payload = { type: p.type, toolCallId: p.toolCallId, tool: executionDisplayText(p.tool, 100), display }; break;
    }
    case "tool_finished": payload = { type: p.type, toolCallId: p.toolCallId, tool: executionDisplayText(p.tool, 100), isError: p.isError,
      summary: executionDisplayText(p.summary), truncated: p.truncated, originalBytes: p.originalBytes, ...(p.artifactRef ? { artifactRef: p.artifactRef } : {}) }; break;
    case "question": payload = { type: p.type, question: projectExecutionQuestion(p.question) }; break;
    case "state": payload = { type: p.type, status: p.status, cancelRequested: p.cancelRequested, stopConfirmed: p.stopConfirmed }; break;
    case "gap": payload = { type: p.type, from: p.from, through: p.through, reason: p.reason }; break;
    case "usage": payload = { type: p.type, input: p.input, output: p.output }; break;
  }
  return { workId: event.workId, sessionId: event.sessionId, runId: event.runId, attemptId: event.attemptId, seq: event.seq, at: event.at, payload };
}

export function projectExecutionSnapshot(snapshot: ExecutionSnapshot): ExecutionSnapshot {
  return { workId: snapshot.workId, sessionId: snapshot.sessionId, runId: snapshot.runId, attemptId: snapshot.attemptId,
    highWatermark: snapshot.highWatermark, status: snapshot.status, cancelRequested: snapshot.cancelRequested, stopConfirmed: snapshot.stopConfirmed,
    finalMessage: snapshot.finalMessage ? { messageId: snapshot.finalMessage.messageId, text: executionDisplayText(snapshot.finalMessage.text),
      truncated: snapshot.finalMessage.truncated, ...(snapshot.finalMessage.artifactRef ? { artifactRef: snapshot.finalMessage.artifactRef } : {}) } : null,
    questions: snapshot.questions.map(projectExecutionQuestion), missing: snapshot.missing, expiresAt: snapshot.expiresAt };
}
