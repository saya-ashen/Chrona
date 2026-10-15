"""Pure helpers for explicit commands quoting old Chrona notifications."""
import re

REF_CHARS = "2-9A-HJKMNP-Z"
_REF = re.compile(rf"^[{REF_CHARS}]{{4}}$", re.I)
_COMMAND = re.compile(r"^\s*/chrona(?=\s|$)(.*)$", re.I | re.S)
ACTIONS = {
    "确认", "同意", "批准", "confirm", "拒绝", "decline",
    "暂后", "稍后", "晚点", "snooze", "完成", "已处理", "done",
    "忽略", "dismiss", "少提醒", "暂停", "pause", "恢复", "继续", "resume",
    "撤销", "取消", "停止", "revoke", "stop", "收到", "已读", "知道了", "ack",
    "反馈", "feedback", "补充", "回答", "答复",
}
_QUOTED_REFS = re.compile(rf"(?:/chrona\s+|回复「)([{REF_CHARS}]{{4}})(?![A-Za-z0-9])", re.I)


def quoted_ref(quoted):
    """The single reply ref of a quoted Chrona notification, else None."""
    if not quoted or not quoted.lstrip().startswith("【Chrona】"):
        return None
    refs = {m.upper() for m in _QUOTED_REFS.findall(quoted)}
    return refs.pop() if len(refs) == 1 else None


def rewrite_quoted(own_text, quoted):
    """Extract the user's explicit command, adding a unique quoted ref if absent."""
    match = _COMMAND.match(own_text or "")
    if not match:
        return None
    args = match.group(1).lstrip()
    tokens = args.split()
    ref = quoted_ref(quoted)
    if ref and tokens and tokens[0] in ACTIONS and not any(_REF.fullmatch(t) for t in tokens):
        args = f"{ref} {args}"
    return f"/chrona {args}" if args else "/chrona"
