"""Smoke tests for the Chrona Hermes plugin.

By default these tests run offline with mocked Chrona MCP responses. Use
`--live` to also verify that a running Chrona server exposes usable MCP tools.
"""

import argparse
import importlib.util
import json
import os
import sys
import unittest
from pathlib import Path


PLUGIN_DIR = Path(__file__).resolve().parent
PACKAGE_NAME = "chrona_hermes_plugin_smoke"


def load_plugin_package():
    spec = importlib.util.spec_from_file_location(
        PACKAGE_NAME,
        PLUGIN_DIR / "__init__.py",
        submodule_search_locations=[str(PLUGIN_DIR)],
    )
    if spec is None or spec.loader is None:
        raise RuntimeError("Unable to load Chrona Hermes plugin package")

    module = importlib.util.module_from_spec(spec)
    sys.modules[PACKAGE_NAME] = module
    spec.loader.exec_module(module)
    return module


plugin = load_plugin_package()
tools = plugin.tools

SAMPLE_INPUT_SCHEMA = {
    "type": "object",
    "properties": {
        "workspaceId": {"type": "string"},
        "taskId": {"type": "string"},
        "payload": {
            "type": "object",
            "properties": {"title": {"type": "string"}},
        },
    },
    "required": ["workspaceId"],
}

SAMPLE_CHRONA_TOOLS = [
    {
        "name": "chrona.task.read",
        "description": "Read task lifecycle state.",
        "inputSchema": SAMPLE_INPUT_SCHEMA,
    },
    {
        "name": "chrona.task.update",
        "description": "Update task fields through Chrona validation.",
        "inputSchema": SAMPLE_INPUT_SCHEMA,
    },
]


class FakeHermesContext:
    def __init__(self):
        self.hooks = []
        self.tools = []

    def register_hook(self, name, handler):
        self.hooks.append({"name": name, "handler": handler})

    def register_tool(self, name, toolset, schema, handler):
        self.tools.append(
            {"name": name, "toolset": toolset, "schema": schema, "handler": handler}
        )


class ChronaHermesPluginSmokeTests(unittest.TestCase):
    def setUp(self):
        self.original_safe_json_rpc = tools._safe_json_rpc
        self.original_list_chrona_tools = tools.list_chrona_tools
        tools.capture_session_context("", model=None, platform=None)

    def tearDown(self):
        tools._safe_json_rpc = self.original_safe_json_rpc
        tools.list_chrona_tools = self.original_list_chrona_tools
        tools.capture_session_context("", model=None, platform=None)

    def test_schema_conversion_preserves_chrona_input_schema(self):
        schema = tools.schema_for_chrona_tool(SAMPLE_CHRONA_TOOLS[1])

        self.assertEqual(schema["name"], "chrona_task_update")
        self.assertEqual(schema["description"], "Update task fields through Chrona validation.")
        self.assertEqual(schema["parameters"], SAMPLE_INPUT_SCHEMA)

    def test_register_exposes_hermes_safe_chrona_tools_not_wrappers(self):
        tools.list_chrona_tools = lambda: SAMPLE_CHRONA_TOOLS
        ctx = FakeHermesContext()

        plugin.register(ctx)

        registered_names = [tool["name"] for tool in ctx.tools]
        self.assertEqual([hook["name"] for hook in ctx.hooks], ["pre_llm_call"])
        self.assertEqual(registered_names, ["chrona_task_read", "chrona_task_update"])
        self.assertNotIn("chrona_tools_list", registered_names)
        self.assertNotIn("chrona_tool_call", registered_names)
        self.assertTrue(all("." not in name for name in registered_names))
        self.assertTrue(all(tool["toolset"] == "chrona" for tool in ctx.tools))

    def test_handler_forwards_call_with_session_context(self):
        calls = []

        def fake_json_rpc(method, params=None):
            calls.append({"method": method, "params": params})
            if params is None:
                raise AssertionError("params are required")
            return {"status": "accepted", "arguments": params["arguments"]}

        tools._safe_json_rpc = fake_json_rpc
        handler = tools.handler_for_chrona_tool("chrona.task.update")
        result = json.loads(
            handler(
                {"workspaceId": "workspace-1", "taskId": "task-1"},
                session_id="session-1",
                task_id="task-run-1",
                model="hermes-model",
                platform="cli",
            )
        )

        self.assertEqual(calls[0]["method"], "tools/call")
        self.assertEqual(calls[0]["params"]["name"], "chrona.task.update")
        self.assertEqual(result["arguments"]["sessionId"], "session-1")
        self.assertEqual(result["arguments"]["actorType"], "agent")
        self.assertEqual(result["arguments"]["actorId"], "hermes:session-1")
        self.assertEqual(result["arguments"]["evidence"]["hermes"]["model"], "hermes-model")
        self.assertEqual(result["arguments"]["evidence"]["hermes"]["platform"], "cli")

    def test_handler_preserves_non_ascii_tool_results(self):
        tools._safe_json_rpc = lambda method, params=None: {
            "status": "accepted",
            "message": "工具已执行。",
            "state": {"taskTitle": "制作一个汉堡"},
        }
        handler = tools.handler_for_chrona_tool("chrona.task.read")

        raw = handler({"taskId": "task-1"})
        result = json.loads(raw)

        self.assertIn("制作一个汉堡", raw)
        self.assertNotIn("\\u5236", raw)
        self.assertEqual(result["state"]["taskTitle"], "制作一个汉堡")

    def test_explicit_actor_and_evidence_are_preserved(self):
        enriched = tools._inject_session_context(
            {
                "workspaceId": "workspace-1",
                "sessionId": "explicit-session",
                "actorType": "human",
                "actorId": "user-1",
                "evidence": {"providerText": "existing"},
            },
            {"session_id": "hermes-session"},
        )

        self.assertEqual(enriched["sessionId"], "explicit-session")
        self.assertEqual(enriched["actorType"], "human")
        self.assertEqual(enriched["actorId"], "user-1")
        self.assertEqual(enriched["evidence"]["providerText"], "existing")
        self.assertEqual(enriched["evidence"]["hermes"]["session_id"], "hermes-session")

    def test_list_chrona_tools_rejects_invalid_mcp_payload(self):
        tools._safe_json_rpc = lambda method, params=None: {"unexpected": []}

        with self.assertRaisesRegex(RuntimeError, "invalid payload"):
            tools.list_chrona_tools()


def run_live_smoke():
    chrona_tools = tools.list_chrona_tools()
    names = [tool.get("name") for tool in chrona_tools]
    if not names:
        raise RuntimeError("Chrona MCP returned no tools")
    if "chrona_tools_list" in names or "chrona_tool_call" in names:
        raise RuntimeError("Chrona MCP exposed obsolete wrapper tools")
    if not all(str(name).startswith("chrona.") for name in names):
        raise RuntimeError(f"Chrona MCP returned unexpected tool names: {names}")
    for tool in chrona_tools:
        schema = tools.schema_for_chrona_tool(tool)
        if "." in schema.get("name", ""):
            raise RuntimeError(f"Tool {tool.get('name')} was not converted for Hermes")
        if not isinstance(schema.get("parameters"), dict):
            raise RuntimeError(f"Tool {tool.get('name')} has invalid schema")

    workspace_id = os.environ.get("CHRONA_SMOKE_WORKSPACE_ID")
    task_id = os.environ.get("CHRONA_SMOKE_TASK_ID")
    if workspace_id and task_id:
        result = json.loads(
            tools.handler_for_chrona_tool("chrona.task.read")(
                {"workspaceId": workspace_id, "taskId": task_id},
                session_id="hermes-smoke-session",
                model="smoke-test",
                platform="cli",
            )
        )
        if not isinstance(result, dict):
            raise RuntimeError("Chrona task.read returned non-object result")

    print(f"live Chrona MCP smoke passed: {len(names)} tools")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--live", action="store_true", help="also call a running Chrona MCP server")
    args, remaining = parser.parse_known_args()

    if args.live:
        run_live_smoke()

    unittest.main(argv=[sys.argv[0], *remaining])
