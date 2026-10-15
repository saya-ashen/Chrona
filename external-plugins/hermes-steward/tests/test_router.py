"""Quote routing remains local and never guesses among reply codes."""
import importlib.util
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location("steward_router", Path(__file__).parents[1] / "router.py")
router = importlib.util.module_from_spec(spec)
spec.loader.exec_module(router)


class QuoteTests(unittest.TestCase):
    def test_unique_ref_in_both_notification_formats(self):
        for quoted in ("【Chrona】异常\n回复：/chrona 3NT4 收到｜暂后",
                       "【Chrona】旧格式\n回复「3nt4 收到/暂后」",
                       "【Chrona】/chrona 3NT4 收到 /chrona 3nt4 暂后"):
            self.assertEqual(router.quoted_ref(quoted), "3NT4")

    def test_untrusted_or_ambiguous_quote_gives_no_ref(self):
        for quoted in ("随便聊聊 /chrona 3NT4 收到", "【Chrona】/chrona 3NT4 收到 /chrona K7QM 收到", ""):
            self.assertIsNone(router.quoted_ref(quoted))
            self.assertEqual(router.rewrite_quoted("/chrona 暂后", quoted), "/chrona 暂后")

    def test_explicit_commands_only_and_existing_refs_preserved(self):
        quoted = "【Chrona】x\n回复：/chrona 3NT4 收到｜暂后"
        cases = {
            "/chrona 暂后": "/chrona 3NT4 暂后",
            "/chrona 补充 周五  下午": "/chrona 3NT4 补充 周五  下午",
            "  /Chrona 完成": "/chrona 3NT4 完成",
            "/chrona K7QM 暂停": "/chrona K7QM 暂停",
            "/chrona 暂停 K7QM": "/chrona 暂停 K7QM",
            "/chrona 暂停 工作 K7QM": "/chrona 暂停 工作 K7QM",
            "/chrona 帮我研究  两种方案": "/chrona 帮我研究  两种方案",
            "/chrona": "/chrona",
            "暂后": None, "/chronax 暂后": None,
            "看看这个 /chrona 暂后": None, "```/chrona 暂后```": None,
        }
        for own, expected in cases.items():
            with self.subTest(own=own):
                self.assertEqual(router.rewrite_quoted(own, quoted), expected)


if __name__ == "__main__":
    unittest.main()
