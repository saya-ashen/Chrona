"""Local migration notice only: no storage, credentials or Chrona transport."""
import unicodedata

try:
    from . import router
except ImportError:  # loaded as a standalone module (tests)
    import importlib.util as _util
    from pathlib import Path
    _spec = _util.spec_from_file_location("chrona_steward_router", Path(__file__).with_name("router.py"))
    router = _util.module_from_spec(_spec)
    _spec.loader.exec_module(router)


class Bridge:
    def command(self, raw_args):
        # Preserve ordinary spacing; remove controls, including bidi formatting.
        example = "".join(c for c in (raw_args or "") if not unicodedata.category(c).startswith("C"))[:200]
        if not example.strip():
            example = "帮助"
        return (
            "【Chrona】Chrona 已迁移到独立的 QQ 机器人「Chrona」，这里不再处理 Chrona 事务，"
            "本条未做任何更改。请在新机器人私聊中直接发送需求或回复码（无需 /chrona 前缀），"
            f"例如：{example}。旧通知里的回复码在新机器人中仍然有效。"
        )

    def pre_gateway_dispatch(self, event=None, **_):
        """Only rewrite explicit commands quoting old notices; ordinary chat is untouched."""
        try:
            source = getattr(event, "source", None)
            platform = getattr(getattr(source, "platform", None), "value", getattr(source, "platform", None))
            if platform != "qqbot" or not getattr(event, "allow_gateway_control", True):
                return None
            raw = getattr(event, "raw_message", None)
            raw = raw if isinstance(raw, dict) else {}
            own = str(raw.get("content", getattr(event, "text", "")) or "")
            quoted = ""
            try:
                if int(raw.get("message_type", 0) or 0) == 103 and isinstance(raw.get("msg_elements"), list):
                    quoted = "\n".join(str(e.get("content", "")) for e in raw["msg_elements"] if isinstance(e, dict))
            except (TypeError, ValueError):
                quoted = ""
            text = router.rewrite_quoted(own, quoted) if quoted else None
            return {"action": "rewrite", "text": text} if text and text != getattr(event, "text", None) else None
        except Exception:
            return None
