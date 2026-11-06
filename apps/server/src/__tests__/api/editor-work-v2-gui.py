"""Opt-in real keyboard GUI driver; HTTP always reaches the actual test host."""
import json
import os
import signal
import subprocess
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(os.environ["CHRONA_U_GUI_ROOT"])
OUT = Path(os.environ["CHRONA_U_GUI_EVIDENCE"])
ORIGIN = os.environ["CHRONA_U_GUI_URL"]
WORKBENCH = "/home/saya/workspace/agent-workbench.nvim"
NVIM = "/nix/store/a1p5rqgn9gma700x576fbysf36rnb1sh-neovim-unwrapped-0.12.6/bin/nvim"
XDO = "/nix/store/4l2ilz3n3n0lzbdx0hb4ymrf02jyvf51-xdotool-4.20260303.1/bin/xdotool"
children = []
env = os.environ.copy()
for kind in ("CONFIG", "DATA", "STATE", "CACHE"):
    env["XDG_" + kind + "_HOME"] = str(ROOT / "gui-xdg" / kind.lower())
env.pop("NVIM", None)
env.pop("VIMINIT", None)
request_counter = 0
receipt = {"kind": "real keyboard -> Neovim -> authenticated Hono -> SDK/coding -> SQLite/PiRun/fakePi", "checks": []}


def http(path, body=None, allow_error=False):
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(ORIGIN + path, data=data, headers={"authorization": "Bearer synthetic-u-final-gui", "content-type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=15) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        if allow_error:
            return json.load(error)
        raise


def command(op, **args):
    global request_counter
    request_counter += 1
    response = http("/api/editor/v1/commands", {"v": "chrona.execution.v2", "requestId": "gui-driver-" + str(request_counter), "command": {"op": op, **args}})
    assert response["ok"], response
    return response["data"]


def until(read, accept, label, seconds=20):
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        value = read()
        if accept(value):
            return value
        time.sleep(0.1)
    raise AssertionError("Timeout: " + label + " last=" + repr(value)[:700])


def all_works():
    roots = command("list", resource="works", limit=100)["works"]
    return roots + [child for parent in roots if parent["kind"] == "group" for child in command("list", resource="works", parentWorkId=parent["workId"], limit=100)["works"]]


def launches():
    path = ROOT / "launches.jsonl"
    return [json.loads(line) for line in path.read_text().splitlines()] if path.exists() else []


def stop_signal(_signum, _frame):
    raise RuntimeError("GUI driver interrupted")


signal.signal(signal.SIGTERM, stop_signal)
try:
    display = next(":" + str(i) for i in range(188, 199) if not Path("/tmp/.X11-unix/X" + str(i)).exists())
    env["DISPLAY"] = display
    xvfb = subprocess.Popen(["/nix/store/pg7d981bvshg7dv3ncq1dr2k9l60795m-xvfb-21.1.24/bin/Xvfb", display, "-screen", "0", "1440x1000x24", "-nolisten", "tcp"], stdout=subprocess.DEVNULL, stderr=(OUT / "xvfb.log").open("w"))
    children.append(xvfb)
    until(lambda: Path("/tmp/.X11-unix/X" + display[1:]).exists(), bool, "Xvfb own display", 5)
    socket = str(ROOT / "gui.sock")
    gui = subprocess.Popen(["/nix/store/1icsv82zkwndwjq0ng0yfnanpfyjz1x2-xterm-411/bin/xterm", "-fa", "DejaVu Sans Mono", "-fs", "12", "-geometry", "140x48+0+0", "-title", "ChronaUFinalRealHTTP", "-e", NVIM, "-i", "NONE", "--listen", socket, "-u", str(Path(__file__).with_name("editor-work-v2-gui-init.lua"))], cwd=WORKBENCH, env=env, stdout=(OUT / "nvim.log").open("w"), stderr=subprocess.STDOUT)
    children.append(gui)
    until(lambda: Path(socket).exists(), bool, "Neovim own RPC socket", 10)

    def rpc(expr):
        result = subprocess.run([NVIM, "--headless", "--server", socket, "--remote-expr", expr], cwd=WORKBENCH, env=env, capture_output=True, text=True, timeout=5)
        assert result.returncode == 0, result.stderr
        return (result.stdout + result.stderr).strip()

    def lua(expr):
        return rpc("luaeval(" + json.dumps(expr) + ")")

    until(lambda: lua('require("agent-workbench.sessions.manager").get() ~= nil'), lambda value: value == "true", "Workbench session")
    window = subprocess.check_output([XDO, "search", "--name", "ChronaUFinalRealHTTP"], env=env, text=True).strip().splitlines()[-1]
    subprocess.run([XDO, "windowfocus", "--sync", window], env=env, check=True)

    def key(*keys):
        subprocess.run([XDO, "key", *keys], env=env, check=True)
        time.sleep(0.2)

    def text(value):
        subprocess.run([XDO, "type", "--clearmodifiers", "--delay", "1", str(value)], env=env, check=True)
        time.sleep(0.1)

    def choose(number):
        until(lambda: lua('vim.fn.mode()'), lambda mode: mode.startswith("r") or mode == "c", "native selection ready")
        text(number)
        key("Return")

    def answer(value, default=False):
        until(lambda: lua('vim.fn.mode()'), lambda mode: mode == "c", "native input ready")
        if default:
            key("ctrl+u")
        if str(value):
            text(value)
        key("Return")

    def capture(name):
        time.sleep(0.3)
        subprocess.run(["/nix/store/clx4xcbrg16dhzyzm2faxjddfk9rz979-imagemagick-7.1.2-27/bin/import", "-display", display, "-window", window, str(OUT / (name + ".png"))], env=env, check=True, timeout=10)

    def open_menu():
        key("Escape")
        for _ in range(30):
            if lua('vim.api.nvim_buf_get_name(0):find("^chrona%-work://") ~= nil') != "true":
                break
            key("q")
        lua('vim.schedule(function() require("agent-workbench.ui.chrona_work").open(require("agent-workbench.sessions.manager").get().backend) end) == nil')
        time.sleep(0.3)

    def open_work(work):
        open_menu()
        choose(3)
        answer(work)
        time.sleep(0.4)

    open_menu()
    capture("01-menu")
    key("Escape")
    assert not launches() and not all_works()
    receipt["checks"].append("cancel initial menu: no start or cancel")
    open_menu()
    choose(2)
    answer("GUI three fixed-location children")
    answer("3", default=True)
    for index, goal in enumerate(["gui-question", "gui-parallel", "gui-dependent"]):
        answer(goal)
        choose(1)  # actual location catalog
        choose(2)  # independent commit worktree
        answer("2,5,10", default=True)
        if index == 0:
            choose(1)
            answer(str(ROOT / "project"), default=True)
            capture("02-related-save-confirm")
            choose(1)
        else:
            choose(2)  # explicitly baseline-only
    answer("")
    answer("")
    answer("1")
    capture("03-frozen-submit-review")
    assert not launches(), "no execution before explicit final submit"
    choose(1)
    works = until(lambda: all_works(), lambda rows: len(rows) == 4, "GUI-created frozen group")
    parent = next(work for work in works if work["kind"] == "group")
    by_goal = {work["goal"]: work for work in works if work["kind"] == "execution"}
    first, parallel, dependent = [by_goal[goal] for goal in ["gui-question", "gui-parallel", "gui-dependent"]]
    running = until(launches, lambda rows: len(rows) == 2, "two independent Pi processes")
    assert len({row["cwd"] for row in running}) == 2
    assert not command("get", workId=dependent["workId"])["execution"]
    first = command("get", workId=first["workId"])
    assert first["workspace"]["sourceReceipt"]["stage"] == "claim"
    assert first["workspace"]["sourceReceipt"]["fileCount"] == 1
    assert all(row["mode"] != "gui-dependent" for row in running)
    receipt["checks"].append("real keyboard group3, explicit related buffer save, claim source receipt; two independent Pi processes live; dependent has no attempt")
    key("Escape")
    key("ctrl+l")
    capture("04-parent-parallel-dependency")
    open_work(first["workId"])
    choose(5)  # actual independent leaf session
    until(lambda: lua('(function() local b=require("agent-workbench.sessions.manager").get().backend; return b._view ~= nil and b._recovery_watermark ~= 0 and b._cursor ~= nil end)()'), lambda value: value == "true", "initial history recovery before fresh question")
    quiet_polls = until(lambda: [item for item in http("/__u_test/state")["traffic"] if item.get("entry") == "editor" and item.get("command", {}).get("op") == "events" and item["command"].get("workId") == first["workId"]], lambda rows: len(rows) >= 4, "two full quiet cursor repolls", seconds=45)
    assert "Editor request unavailable" not in rpc("execute('messages')")
    receipt["quietPollRequests"] = len(quiet_polls)
    (ROOT / "ask-gui-question").write_text("emit a fresh live interaction after attach")
    until(lambda: lua('require("agent-workbench.sessions.manager").get().chat:has_prompt_request()'), lambda value: value == "true", "exact child Attention")
    capture("05-exact-child-attention")
    key("Return")
    until(lambda: command("get", workId=first["workId"]), lambda view: view["phase"] == "completed", "answered child actual Pi stop")
    until(launches, lambda rows: any(row["mode"] == "gui-dependent" for row in rows), "dependency starts after exact immutable result")
    dependent = until(lambda: command("get", workId=dependent["workId"]), lambda view: view["phase"] == "completed", "dependent completes")
    predecessor = command("results", workId=first["workId"])["results"][0]
    dependent_prompt = (ROOT / "prompt-gui-dependent.txt").read_text()
    (OUT / "dependent-provider-prompt.txt").write_text(dependent_prompt)
    assert predecessor["artifactRef"] in dependent_prompt and predecessor["attemptId"] in dependent_prompt
    assert "gui-question immutable completed" in dependent_prompt
    assert parallel["workId"] not in dependent_prompt and "gui-parallel finished" not in dependent_prompt
    state = http("/__u_test/state")
    question = next(row["details"] for row in state["questions"] if row["details"]["runId"] == first["execution"]["runId"])
    duplicate = http("/__u_test/owner", {"target": "coding.answer", "input": {"workId": first["workId"], "runId": first["execution"]["runId"], "attemptId": first["execution"]["attemptId"], "requestId": question["id"], "commandKey": "other-entry-duplicate", "answer": {"decision": "submit", "value": True}}}, allow_error=True)
    assert "error" in duplicate
    assert len((ROOT / "answers.jsonl").read_text().splitlines()) == 1
    receipt["checks"].append("Neovim exact child question answer once; cross-owner duplicate refused; dependent consumes completed immutable result")
    (ROOT / "finish-gui-parallel").write_text("finish")
    parallel = until(lambda: command("get", workId=parallel["workId"]), lambda view: view["phase"] == "completed", "parallel completion")
    results = command("results", workId=parent["workId"])["results"]
    first_index = next(i + 1 for i, result in enumerate(results) if result["workId"] == first["workId"])
    remaining = [result for result in results if result["workId"] != first["workId"]]
    second_index = next(i + 1 for i, result in enumerate(remaining) if result["workId"] == parallel["workId"])
    open_work(parent["workId"])
    choose(3)
    choose(first_index)
    choose(second_index)
    choose(1)  # common published file snapshot
    key("Escape")
    key("ctrl+l")
    capture("06-immutable-two-result-diff")
    buffers = json.loads(lua('vim.json.encode(vim.tbl_map(function(buf) return {name=vim.api.nvim_buf_get_name(buf),readonly=vim.bo[buf].readonly,modifiable=vim.bo[buf].modifiable,lines=vim.api.nvim_buf_get_lines(buf,0,-1,false)} end,vim.api.nvim_list_bufs()))'))
    diff = [buf for buf in buffers if "A快照" in buf["name"] or "B快照" in buf["name"]]
    assert len(diff) == 2 and all(buf["readonly"] and not buf["modifiable"] for buf in diff)
    (OUT / "comparison-buffers.json").write_text(json.dumps(diff, ensure_ascii=False, indent=2))
    assert any("gui-question finished" in "\n".join(buf["lines"]) for buf in diff)
    assert any("gui-parallel finished" in "\n".join(buf["lines"]) for buf in diff)
    assert not any(result["accepted"] for result in command("results", workId=parent["workId"])["results"])
    open_work(parent["workId"])
    choose(2)
    choose(first_index)
    choose(2)
    accepted = until(lambda: command("results", workId=parent["workId"])["results"], lambda rows: any(row["workId"] == first["workId"] and row["accepted"] for row in rows), "explicit precise result accept")
    assert (Path(running[0]["cwd"]) / "answer.txt").exists()
    receipt["checks"].append("two actual immutable results via MCP SHA checks; readonly comparison does not accept; explicit accept leaves worktree")

    def create_leaf(goal):
        open_menu()
        choose(1)
        answer(goal)
        choose(1)
        choose(2)
        answer("2,5,10", default=True)
        choose(2)
        choose(1)
        return until(lambda: all_works(), lambda rows: any(row["goal"] == goal for row in rows), "GUI leaf " + goal)

    create_leaf("gui-cancel")
    cancel_view = next(row for row in all_works() if row["goal"] == "gui-cancel")
    cancel_launch = until(launches, lambda rows: any(row["mode"] == "gui-cancel" for row in rows), "cancel leaf process")
    open_work(cancel_view["workId"])
    choose(4)
    capture("07-exact-leaf-cancel-confirm")
    choose(1)
    cancelled = until(lambda: command("get", workId=cancel_view["workId"]), lambda view: view["phase"] == "cancelled", "real cancellation stop")
    owner_view = http("/__u_test/owner", {"target": "coding.work", "input": {"v": "chrona.execution.v2", "requestId": "cross-entry-get", "command": {"op": "get", "workId": cancel_view["workId"]}}})
    assert owner_view["workId"] == cancelled["workId"] and owner_view["phase"] == "cancelled"
    receipt["checks"].append("keyboard exact leaf cancel, actual stop, owner coding.work sees same cancelled work")
    create_leaf("gui-clean")
    clean = next(row for row in all_works() if row["goal"] == "gui-clean")
    clean = until(lambda: command("get", workId=clean["workId"]), lambda view: view["phase"] == "completed", "clean actual Pi stop")
    clean_launch = next(row for row in launches() if row["mode"] == "gui-clean")
    open_work(clean["workId"])
    choose(6)
    capture("08-cleanup-preview-before-confirm")
    assert Path(clean_launch["cwd"]).exists(), "preview must not delete"
    choose(2)
    assert Path(clean_launch["cwd"]).exists(), "cancel cleanup must retain"
    open_work(clean["workId"])
    choose(6)
    choose(1)
    until(lambda: Path(clean_launch["cwd"]).exists(), lambda exists: not exists, "real cleanup exact owned tree")
    key("ctrl+l")
    capture("09-cleanup-actual-receipt")
    open_menu()
    choose(6)  # recover exact prior cleanup receipt, no new deletion key
    time.sleep(0.4)
    assert not Path(clean_launch["cwd"]).exists()
    open_work(first["workId"])
    choose(6)
    time.sleep(0.4)
    key("ctrl+l")
    capture("10-dirty-retained-cleanup-refused")
    assert Path(next(row["cwd"] for row in launches() if row["mode"] == "gui-question")).exists()
    receipt["checks"].append("actual cleanup preview/cancel retains, fresh preview/confirm removes only pristine owned stopped tree, original receipt recovery, dirty accepted tree retained")
    messages = rpc("execute('messages')")
    assert "Chrona unavailable" not in messages and "Editor request unavailable" not in messages, messages
    receipt["checks"].append("quiet bounded v2 polling leaves no unavailable notification while controls remain responsive")
    receipt.update(parent=parent["workId"], children=[first["workId"], parallel["workId"], dependent["workId"]], launches=launches(), resultRefs=[{key: result[key] for key in ["workId", "resultId", "artifactRef", "baseline"]} for result in accepted])
    (OUT / "gui-receipt.json").write_text(json.dumps(receipt, indent=2))
    lua('vim.schedule(function() vim.cmd("qa!") end) == nil')
    gui.wait(timeout=10)
    assert gui.returncode == 0
    print("PASS", "; ".join(receipt["checks"]))
except Exception:
    if "capture" in globals():
        capture("failure")
        (OUT / "failure-messages.txt").write_text(rpc("execute('messages')"))
        (OUT / "failure-local.txt").write_text(lua('vim.inspect(vim.tbl_map(function(s) return {id=s.id,work=s.backend._work_id,view=s.backend._view,request=s.chat:has_prompt_request(),attention=s.attention} end,require("agent-workbench.sessions.manager").list()))'))
    raise
finally:
    for child in reversed(children):
        if child.poll() is None:
            child.terminate()
            try:
                child.wait(timeout=5)
            except subprocess.TimeoutExpired:
                child.kill()
                child.wait()
    print("Stopped only own Xvfb/xterm/Neovim children")
