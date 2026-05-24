"""Chrona Hermes plugin registration."""

from . import tools


def register(ctx):
    """Register Chrona MCP tools with Hermes."""
    for tool in tools.list_chrona_tools():
        name = tool.get("name")
        if not isinstance(name, str) or not name:
            continue
        ctx.register_tool(
            name=tools.hermes_tool_name(name),
            toolset="chrona",
            schema=tools.schema_for_chrona_tool(tool),
            handler=tools.handler_for_chrona_tool(name),
        )
