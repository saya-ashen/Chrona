"""Native GTK 4 window; stdin commands and stdout evidence are private to entry.ts.
Uses the stable C ABI through ctypes so no Python GTK binding or headers are needed.
"""
import ctypes as c
import json
import os
import queue
import sys
import threading


def emit(event):
    print(json.dumps({"event": event}), flush=True)


def main():
    with open(sys.argv[1], encoding="utf-8") as config:
        library = json.load(config)["gtkLibrary"]
    gtk = c.CDLL(library)

    def api(name, result, *args):
        fn = getattr(gtk, name)
        fn.restype = result
        fn.argtypes = list(args)
        return fn

    ptr = c.c_void_p
    init = api("gtk_init_check", c.c_int)
    if not init():
        raise RuntimeError("GTK could not connect to the local desktop session")
    new = api("gtk_window_new", ptr)
    title = api("gtk_window_set_title", None, ptr, c.c_char_p)
    size = api("gtk_window_set_default_size", None, ptr, c.c_int, c.c_int)
    label = api("gtk_label_new", ptr, c.c_char_p)
    child = api("gtk_window_set_child", None, ptr, ptr)
    present = api("gtk_window_present", None, ptr)
    close = api("gtk_window_close", None, ptr)
    loop_new = api("g_main_loop_new", ptr, ptr, c.c_int)
    loop_run = api("g_main_loop_run", None, ptr)
    loop_quit = api("g_main_loop_quit", None, ptr)
    connect = api("g_signal_connect_data", c.c_ulong, ptr, c.c_char_p, ptr, ptr, ptr, c.c_int)
    idle_add = api("g_idle_add", c.c_uint, ptr, ptr)
    window = new()
    title(window, b"Chrona Desktop Demo")
    size(window, 480, 200)
    child(window, label("Chrona 的普通本地桌面应用\n\n关闭窗口后，应用仍可再次打开窗口。".encode()))
    loop = loop_new(None, 0)
    mapped = False

    @c.CFUNCTYPE(None, ptr, ptr)
    def on_map(_widget, _data):
        nonlocal mapped
        if not mapped:
            mapped = True
            emit("mapped")

    @c.CFUNCTYPE(c.c_int, ptr, ptr)
    def on_close(_widget, _data):
        emit("close-requested")
        loop_quit(loop)
        return 0

    commands = queue.Queue()

    @c.CFUNCTYPE(c.c_int, ptr)
    def drain(_data):
        command = commands.get()
        if command == "focus":
            present(window)
            emit("presented")
        elif command == "close":
            close(window)
        return 0

    def read_commands():
        for line in sys.stdin:
            command = line.strip()
            if command in ("focus", "close"):
                commands.put(command)
                idle_add(drain, None)
        commands.put("close")
        idle_add(drain, None)

    connect(window, b"map", on_map, None, None, 0)
    connect(window, b"close-request", on_close, None, None, 0)
    threading.Thread(target=read_commands, daemon=True).start()
    present(window)
    loop_run(loop)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(str(error), file=sys.stderr, flush=True)
        sys.exit(1)
