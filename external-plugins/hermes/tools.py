"""Chrona MCP bridge handlers for Hermes."""

import json
import os
import urllib.error
import urllib.request
from itertools import count
from pathlib import Path

_JSON_RPC_IDS = count(1)
_DEFAULT_MCP_URL = "http://127.0.0.1:3101/api/mcp"
_CONFIG_PATH = Path(__file__).resolve().parent / "chrona_config.json"


def _configured_mcp_url():
    if not _CONFIG_PATH.exists():
        return None

    try:
        config = json.loads(_CONFIG_PATH.read_text(encoding="utf-8"))
    except Exception:
        return None

    if not isinstance(config, dict):
        return None

    mcp_url = config.get("mcpUrl")
    return mcp_url if isinstance(mcp_url, str) and mcp_url else None


def _mcp_url():
    return os.environ.get("CHRONA_MCP_URL") or _configured_mcp_url() or _DEFAULT_MCP_URL


def _post_json_rpc(method, params=None):
    body = {
        "jsonrpc": "2.0",
        "id": next(_JSON_RPC_IDS),
        "method": method,
        "params": params or {},
    }
    request = urllib.request.Request(
        _mcp_url(),
        data=json.dumps(body, ensure_ascii=False).encode("utf-8"),
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
        return {
            "error": f"Chrona MCP HTTP {exc.code}",
            "details": details,
            "mcp_url": _mcp_url(),
        }
    except Exception as exc:
        return {"error": str(exc), "mcp_url": _mcp_url()}


def list_chrona_tools():
    """Fetch the current Chrona MCP tool list during Hermes plugin startup."""
    result = _safe_json_rpc("tools/list")
    if "error" in result:
        raise RuntimeError(
            f"Unable to list Chrona tools: {json.dumps(result, ensure_ascii=False)}"
        )

    tools = result.get("tools")
    if not isinstance(tools, list):
        raise RuntimeError(
            f"Chrona tools/list returned invalid payload: {json.dumps(result, ensure_ascii=False)}"
        )
    return tools


def hermes_tool_name(chrona_tool_name):
    """Convert a Chrona MCP tool name into a Hermes-safe tool name."""
    return chrona_tool_name.replace(".", "_")


def schema_for_chrona_tool(tool):
    """Convert one MCP tool description into the Hermes tool schema shape."""
    name = tool.get("name")
    description = tool.get("description") or tool.get("title") or name
    parameters = (
        tool.get("inputSchema")
        or tool.get("parameters")
        or {
            "type": "object",
            "properties": {},
        }
    )

    return {
        "name": hermes_tool_name(name) if isinstance(name, str) else name,
        "description": description,
        "parameters": parameters,
    }


def handler_for_chrona_tool(name):
    """Create a Hermes handler that forwards one Chrona tool call."""

    def _handler(args, **kwargs):
        if not isinstance(args, dict):
            return json.dumps(
                {"error": "tool arguments must be an object"}, ensure_ascii=False
            )
        session_id = _session_id_from_kwargs(kwargs)
        if not session_id:
            return json.dumps(
                {"error": "Hermes session_id is required for Chrona tool calls"},
                ensure_ascii=False,
            )
        return json.dumps(
            _safe_json_rpc(
                "tools/call",
                {"name": name, "arguments": _inject_session_context(args, kwargs)},
            ),
            ensure_ascii=False,
        )

    return _handler


def _session_id_from_kwargs(kwargs):
    session_id = kwargs.get("session_id") or kwargs.get("task_id")
    return session_id if isinstance(session_id, str) and session_id else None


def _current_session_context(kwargs):
    session_id = _session_id_from_kwargs(kwargs)
    if not session_id:
        return {}

    context = {}
    context["session_id"] = session_id

    for key in ("model", "platform"):
        value = kwargs.get(key)
        if value:
            context[key] = value

    return {key: value for key, value in context.items() if value}


def _inject_session_context(arguments, kwargs):
    enriched = dict(arguments)
    context = _current_session_context(kwargs)

    session_id = context.get("session_id")
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
