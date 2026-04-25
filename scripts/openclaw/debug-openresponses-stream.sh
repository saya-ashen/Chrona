#!/usr/bin/env bash
set -euo pipefail

OPENCLAW_OPENRESPONSES_URL="${OPENCLAW_OPENRESPONSES_URL:-http://127.0.0.1:18789}"
OPENCLAW_GATEWAY_TOKEN="${OPENCLAW_GATEWAY_TOKEN:-}"
OPENCLAW_AGENT_ID="${OPENCLAW_AGENT_ID:-main}"
OPENCLAW_MODEL="${OPENCLAW_MODEL:-openclaw}"
OPENCLAW_MESSAGE_CHANNEL="${OPENCLAW_MESSAGE_CHANNEL:-chrona-direct-debug}"
OPENCLAW_SESSION_KEY="${OPENCLAW_SESSION_KEY:-tenant-a:task-001}"
SESSION_ID="${SESSION_ID:-debug-plan-stream}"
TIMEOUT_SECONDS="${TIMEOUT_SECONDS:-60}"

if [[ -z "$OPENCLAW_GATEWAY_TOKEN" ]]; then
  echo "ERROR: OPENCLAW_GATEWAY_TOKEN is required" >&2
  exit 1
fi

REQUEST_BODY=$(cat <<JSON
{
  "model": "${OPENCLAW_MODEL}",
  "user": "${OPENCLAW_SESSION_KEY}",
  "instructions": "[Chrona Feature Request]\nFeature: generate_plan\nReturn plan graph only via function call generate_task_plan_graph.",
  "input": "{\"taskId\":\"task-001\",\"title\":\"Prepare weekly research summary\",\"description\":\"Summarize experiments, blockers, and next steps\",\"estimatedMinutes\":90}",
  "tools": [
    {
      "type": "function",
      "function": {
        "name": "generate_task_plan_graph",
        "description": "Chrona structured feature tool: generate_task_plan_graph",
        "parameters": {
          "type": "object",
          "additionalProperties": true,
          "properties": {
            "summary": { "type": "string" },
            "reasoning": { "type": "string" },
            "nodes": { "type": "array", "items": { "type": "object" } },
            "edges": { "type": "array", "items": { "type": "object" } }
          },
          "required": ["summary", "nodes", "edges"]
        }
      }
    }
  ],
  "tool_choice": {
    "type": "function",
    "function": { "name": "generate_task_plan_graph" }
  },
  "stream": true
}
JSON
)

echo "== OpenClaw OpenResponses raw SSE debug =="
echo "url: ${OPENCLAW_OPENRESPONSES_URL}/v1/responses"
echo "agent: ${OPENCLAW_AGENT_ID}"
echo "model: ${OPENCLAW_MODEL}"
echo "session: ${OPENCLAW_SESSION_KEY}"
echo "channel: ${OPENCLAW_MESSAGE_CHANNEL}"
echo "timeout: ${TIMEOUT_SECONDS}s"
echo

echo "== request body =="
printf '%s\n' "$REQUEST_BODY"
echo

echo "== raw SSE stream =="
curl -N --max-time "$TIMEOUT_SECONDS" \
  "${OPENCLAW_OPENRESPONSES_URL}/v1/responses" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${OPENCLAW_GATEWAY_TOKEN}" \
  -H "x-openclaw-agent-id: ${OPENCLAW_AGENT_ID}" \
  -H "x-openclaw-model: ${OPENCLAW_MODEL}" \
  -H "x-openclaw-message-channel: ${OPENCLAW_MESSAGE_CHANNEL}" \
  -H "x-openclaw-session-key: ${OPENCLAW_SESSION_KEY}" \
  -d "$REQUEST_BODY"
