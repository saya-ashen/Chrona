"""Local migration behavior; never uses real credentials or network."""
import importlib.util
import sys
import types
import unittest
from contextlib import ExitStack
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).parents[1]
spec = importlib.util.spec_from_file_location("steward_bridge", ROOT / "bridge.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class FakeEvent:
    def __init__(self, text, raw=None, platform="qqbot"):
        self.text = text
        self.raw_message = raw
        self.source = types.SimpleNamespace(platform=types.SimpleNamespace(value=platform))
        self.allow_gateway_control = True


class BridgeTests(unittest.TestCase):
    def setUp(self):
        self.bridge = module.Bridge()

    def assert_notice(self, args, example):
        self.assertEqual(self.bridge.command(args),
            "【Chrona】Chrona 已迁移到独立的 QQ 机器人「Chrona」，这里不再处理 Chrona 事务，"
            "本条未做任何更改。请在新机器人私聊中直接发送需求或回复码（无需 /chrona 前缀），"
            f"例如：{example}。旧通知里的回复码在新机器人中仍然有效。")

    def test_all_arguments_are_local_notices(self):
        with ExitStack() as stack:
            mocks = [stack.enter_context(patch(target, side_effect=AssertionError(target))) for target in (
                "urllib.request.urlopen", "urllib.request.build_opener", "urllib.request.OpenerDirector.open",
                "socket.socket", "pathlib.Path.read_text", "pathlib.Path.open", "builtins.open",
            )]
            for args in (None, "", "  ", "帮助", "委托", "帮我准备  周五答辩", "3nt4 暂后 8小时",
                         "暂停", "3NT4", "K7QM 确认", "3NT4 K7QM 暂停", "未知 /chrona 参数"):
                with self.subTest(args=args):
                    self.assert_notice(args, args if args and args.strip() else "帮助")
            for mock in mocks:
                mock.assert_not_called()

    def test_controls_removed_and_echo_bounded(self):
        self.assert_notice("甲\x00\n\r\t\x7f\x85\u202e\u2066乙", "甲乙")
        self.assert_notice("\x00\n", "帮助")
        self.assert_notice("甲" * 201, "甲" * 200)
        self.assert_notice("\x00" * 300 + "乙" * 201, "乙" * 200)

    def test_quoted_action_reaches_notice_with_ref(self):
        event = FakeEvent("[Quoted message]: old notice\n/chrona 暂后", {
            "content": "/chrona 暂后", "message_type": 103,
            "msg_elements": [{"content": "【Chrona】异常\n回复：/chrona 3NT4 收到｜暂后"}],
        })
        result = self.bridge.pre_gateway_dispatch(event=event)
        self.assertEqual(result, {"action": "rewrite", "text": "/chrona 3NT4 暂后"})
        self.assert_notice(result["text"].removeprefix("/chrona "), "3NT4 暂后")

    def test_ordinary_chat_and_quoted_only_commands_untouched(self):
        for text in ("今天 Chrona 怎么样？", "3NT4 暂后", "明天开会", "看看 /chrona 暂后", "好的"):
            event = FakeEvent(text, {"content": text, "message_type": 103,
                "msg_elements": [{"content": "【Chrona】/chrona 3NT4 暂后"}]})
            self.assertIsNone(self.bridge.pre_gateway_dispatch(event=event))
        self.assertIsNone(self.bridge.pre_gateway_dispatch())

    def test_hook_respects_platform_and_gateway_control(self):
        event = FakeEvent("quote", {"content": "/chrona 暂后", "message_type": 103,
            "msg_elements": [{"content": "【Chrona】/chrona 3NT4 收到"}]}, platform="telegram")
        self.assertIsNone(self.bridge.pre_gateway_dispatch(event=event))
        event.source.platform.value = "qqbot"
        event.allow_gateway_control = False
        self.assertIsNone(self.bridge.pre_gateway_dispatch(event=event))

    def test_registers_only_command_and_hook_without_storage(self):
        calls = []
        ctx = types.SimpleNamespace(
            register_command=lambda name, handler, **kw: calls.append(("command", name, handler)),
            register_hook=lambda name, handler: calls.append(("hook", name, handler)))
        spec = importlib.util.spec_from_file_location("chrona_steward_pkg", ROOT / "__init__.py",
            submodule_search_locations=[str(ROOT)])
        pkg = importlib.util.module_from_spec(spec)
        with patch.dict(sys.modules, {"chrona_steward_pkg": pkg}):
            spec.loader.exec_module(pkg)
            with patch("pathlib.Path.read_text") as read, patch("builtins.open") as opened:
                pkg.register(ctx)
                self.assertIn("已迁移", calls[0][2]("委托"))
                read.assert_not_called()
                opened.assert_not_called()
        self.assertEqual([(kind, name) for kind, name, _ in calls],
            [("command", "chrona"), ("hook", "pre_gateway_dispatch")])


if __name__ == "__main__":
    unittest.main()
