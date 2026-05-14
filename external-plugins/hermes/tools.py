"""Chrona MCP bridge handlers for Hermes."""

import json
import os
import urllib.error
import urllib.request
from itertools import count
from threading import Lock

_JSON_RPC_IDS = count(1)
_DEFAULT_MCP_URL = "http://127.0.0.1:3101/api/mcp"
_SESSION_LOCK = Lock()
_CURRENT_SESSION_CONTEXT = {}


def _mcp_url():
    return os.environ.get("CHRONA_MCP_URL", _DEFAULT_MCP_URL)


def _post_json_rpc(method, params=None):
    body = {
        "jsonrpc": "2.0",
        "id": next(_JSON_RPC_IDS),
        "method": method,
        "params": params or {},
    }
    request = urllib.request.Request(
        _mcp_url(),
        data=json.dumps(body).encode("utf-8"),
        headers={
            "content-type": "application/json",
            "accept": "application/json, text/event-stream",
        },
        method="POST",
    )

    with urllib.request.urlopen(request, timeout=30) as response:
        payload = response.read().decode("utf-8")
        return json.loads(payload)


def _safe_json_rpc(method, params=None):
    try:
        response = _post_json_rpc(method, params)
        if "error" in response:
            return {"error": response["error"], "mcp_url": _mcp_url()}
        return response.get("result", response)
    except urllib.error.HTTPError as exc:
        details = exc.read().decode("utf-8", errors="replace")
        return {"error": f"Chrona MCP HTTP {exc.code}", "details": details, "mcp_url": _mcp_url()}
    except Exception as exc:
        return {"error": str(exc), "mcp_url": _mcp_url()}


def list_chrona_tools():
    """Fetch the current Chrona MCP tool list during Hermes plugin startup."""
    result = _safe_json_rpc("tools/list")
    if "error" in result:
        raise RuntimeError(f"Unable to list Chrona tools: {json.dumps(result)}")

    tools = result.get("tools")
    if not isinstance(tools, list):
        raise RuntimeError(f"Chrona tools/list returned invalid payload: {json.dumps(result)}")
    return tools


def schema_for_chrona_tool(tool):
    """Convert one MCP tool description into the Hermes tool schema shape."""
    name = tool.get("name")
    description = tool.get("description") or tool.get("title") or name
    parameters = tool.get("inputSchema") or tool.get("parameters") or {
        "type": "object",
        "properties": {},
    }

    return {
        "name": name,
        "description": description,
        "parameters": parameters,
    }


def handler_for_chrona_tool(name):
    """Create a Hermes handler that forwards one Chrona tool call."""

    def _handler(args, **kwargs):
        if not isinstance(args, dict):
            return json.dumps({"error": "tool arguments must be an object"})
        return json.dumps(
            _safe_json_rpc(
                "tools/call",
                {"name": name, "arguments": _inject_session_context(args, kwargs)},
            )
        )

    return _handler


def capture_session_context(session_id, model=None, platform=None, **kwargs):
    """Remember the current Hermes session for later tool calls."""
    with _SESSION_LOCK:
        _CURRENT_SESSION_CONTEXT.clear()
        _CURRENT_SESSION_CONTEXT.update(
            {
                "session_id": session_id,
                "model": model,
                "platform": platform,
            }
        )


def _current_session_context(kwargs):
    context = {}
    with _SESSION_LOCK:
        context.update(_CURRENT_SESSION_CONTEXT)

    for key in ("session_id", "task_id", "model", "platform"):
        value = kwargs.get(key)
        if value:
            context[key] = value

    return {key: value for key, value in context.items() if value}


def _inject_session_context(arguments, kwargs):
    enriched = dict(arguments)
    context = _current_session_context(kwargs)

    session_id = context.get("session_id") or context.get("task_id")
    if session_id and "sessionId" not in enriched:
        enriched["sessionId"] = session_id

    if "actorType" not in enriched:
        enriched["actorType"] = "agent"
    if session_id and "actorId" not in enriched:
        enriched["actorId"] = f"hermes:{session_id}"

    evidence = enriched.get("evidence")
    if not isinstance(evidence, dict):
        evidence = {}
    hermes_context = evidence.get("hermes")
    if not isinstance(hermes_context, dict):
        hermes_context = {}
    hermes_context.update(context)
    if hermes_context:
        evidence["hermes"] = hermes_context
        enriched["evidence"] = evidence

    return enriched

