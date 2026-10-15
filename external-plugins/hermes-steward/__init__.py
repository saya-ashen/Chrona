"""Hermes 0.21.7 entrypoint. Registers ONE explicit slash command and a pre-dispatch hook; no model
tools and no context injection, so ordinary chat never reaches Chrona."""
from .bridge import Bridge


def register(ctx):
    bridge = Bridge()
    ctx.register_command("chrona", bridge.command, description="Chrona 已迁移至独立 QQ 机器人（仅提示，不执行）", args_hint="[<需求> | <码> <动作>]")
    ctx.register_hook("pre_gateway_dispatch", bridge.pre_gateway_dispatch)
