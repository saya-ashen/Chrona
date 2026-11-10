# Ordinary local desktop demo

This optional ordinary SDK application opens one native GTK 4 window. The persistent Bun module owns a Python child through `node:child_process`; Python uses the installed GTK C ABI through standard-library `ctypes`. It needs no Python GTK bindings, compiler, npm dependency, browser or new kernel API. Nothing opens on module startup. Owner tools `open`, `close` and `status` take no arguments. The manifest uses the existing Bun SDK script entry, `keepAlive`, and no routed uses or network effect.

`open` waits for GTK's `map` signal before returning `window: "mapped"`, `evidence: "gtk-map"` and the helper PID. A repeated `open` reuses that PID, calls `gtk_window_present`, and waits for the helper's acknowledgement. Window-manager focus policy still applies: `focusRequested: true` proves the request, not actual keyboard focus. Closing the window through its titlebar exits only the helper; `status` remains callable with `module: "ready"`, and the next `open` creates a new window. `close` waits for process exit, escalating to TERM/KILL when necessary. A timeout does not count as a successful stop.

## Build and check in this checkout

Run from the Chrona root with existing local Bun and Python 3. A compatible installed Linux GTK 4 shared library and its dependencies are required. Builds probe candidates using Python without opening a window. Override discovery with an absolute `CHRONA_DEMO_GTK_LIBRARY` path if needed. There are no downloads or compiler calls.

```sh
cd /home/saya/workspace/Chrona
flock /tmp/chrona-permanent-check.lock env NODE_OPTIONS=--max-old-space-size=6144 CHRONA_TEST_CONCURRENCY=1 CC=/nix/store/788mx070y81zjlg5ipcl0cra3afviw9k-gcc-wrapper-15.2.0/bin/cc bun --no-install run examples/desktop-demo/build.ts
flock /tmp/chrona-permanent-check.lock env NODE_OPTIONS=--max-old-space-size=6144 CHRONA_TEST_CONCURRENCY=1 CC=/nix/store/788mx070y81zjlg5ipcl0cra3afviw9k-gcc-wrapper-15.2.0/bin/cc bun --no-install test examples/desktop-demo/desktop-demo.bun.test.ts
```

For another checkout, use that checkout's root; `CC` is shown to match this workspace's check policy but the example does not invoke it. The checkout SDK's existing process guardian must be built/available. `check.ts` uses the matching checkout SDK and guardian; exported materials can set `CHRONA_SDK`, `CHRONA_SDK_LOADER` and `CHRONA_PROCESS_HELPER` explicitly to a matching installed distribution.

The offline test uses `startModule` with temporary module/data/content directories and a protocol fixture. It checks missing desktop variables, mapped readiness, repeated-open reuse, simulated user close and reopen, close waiting for PID death, helper failure, and a child that stays alive without reporting a map. It also starts a detached descendant ignoring TERM: `runtime.stop()` must obtain the existing supervisor's descendant-empty stop proof, and both PIDs must be dead. The checkout suite also launches the packaged entry through the production host adapter and round-trips the actual selected material through Author import/export before rebuilding in a fresh directory. Fixture readiness is not evidence of a real desktop window. This test needs neither a live database nor an active desktop.

## Real desktop check without installation

Launch from a terminal belonging to the target desktop session:

```sh
cd /home/saya/workspace/Chrona
bun --no-install run examples/desktop-demo/preview.ts
```

The preview uses the real module entry and SDK `startModule` harness, temporary private data, and the existing process supervisor. Enter these commands interactively:

1. `status`: module ready, window closed.
2. `open`: wait for `gtk-map`; inspect the actual window titled **Chrona Desktop Demo**.
3. `open` again: same PID, `reused: true`, `focusRequested: true`. Confirm compositor behavior separately.
4. Close the titlebar yourself. `status` should show closed and module ready. `open` should create a new PID/window.
5. `close`: window disappears; result has no helper PID.
6. Open once more, then `quit`: preview must print `Supervisor confirmed descendant-empty stop`. Inspect the desktop to confirm the window disappeared. Interrupting the preview with SIGINT/SIGTERM also awaits supervisor stop.

This host session uses `DISPLAY=:0`, `WAYLAND_DISPLAY=wayland-1`, `XDG_RUNTIME_DIR=/run/user/1000`, and `DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus`. These values are host-specific examples, not application defaults. The service must receive its own authorized desktop session environment and access the actual sockets. See [desktop session integration](../../docs/zh/desktop-session.md). A display variable alone does not establish connectivity. Missing variables fail explicitly; an inaccessible socket, incompatible library or GTK startup error is reported through `open` and status. The module passes a small environment allowlist to the helper and does not pass SDK IPC credentials.

GTK's real `map` signal establishes toolkit window mapping, beyond successful process spawn. It does not prove compositor visibility, a rendered frame, focus, or that a person saw the window. Verify those on the target desktop. Real acceptance on this host reached `mapped` through the SDK preview and found Niri window 270 titled `Chrona Desktop Demo` at the matching helper PID, with `is_focused: true`. A second `open` reused the PID. Closing that exact window through Niri produced helper exit 0 while module status stayed ready; reopen created a new PID. Explicit close succeeded, and quitting with a new window open obtained descendant-empty stop proof, helper PID death and absence from Niri. This confirms compositor registration and observed focus in this run; human inspection of rendered content remains separate. The automated SDK lifecycle suite intentionally uses a fixture. Production disable, version replacement, and unexpected host failure need validation through the actual service lifecycle. They use existing module supervision; this example adds no new stop mechanism or claim that a kill request proves cleanup.

## Source and artifact transport

From an exported application workspace, run `bun --no-install run build.ts`. The source selection includes the manifest, launcher, entry, Python helper, build script, tests, preview, documentation and `.gitignore`. `main.ts` is the thin ordinary SDK launcher; explicit native/interpreter objects receive raw IPC credentials without the SDK directory. Generated `dist/entry.js` is the Bun SDK implementation artifact; `dist/backend.json` pins the selected absolute GTK library path. The build writes a Git-visible SHA-256 `chrona-material.json` and ignored `dist/author-import.json` with explicit source/artifact selections. Both artifacts are non-executable: Bun interprets the entry and Python interprets the helper. `.gitignore` excludes outputs only from Git; the generated Author selection explicitly includes them.

Pass the contents of `dist/author-import.json` as the JSON string in `author.import({input: ...})`, using an admitted Author identity. Choose a fresh `to` if `sources/desktop-demo-v1` already exists. Author generates its own material record from actual copied bytes; do not select the root record or the generated import instruction as input material. Existing `author.stage`, `author.export` and `author.submit` handle this ordinary package under their normal admission and immutable-source rules. No installation, submission or activation is performed by the build or preview.

Rebuild on the target host when GTK paths, Python or Bun change. GTK and its dependency closure remain host prerequisites and are not bundled. The recorded source selection, build command, toolchain version, host library path and artifact digests make the material inspectable and rebuildable on a compatible host; they are not a cross-host or bit-for-bit reproducibility guarantee. The portable `test.ts`/`check.ts` and preview require a matching SDK/guardian or checkout; `desktop-demo.bun.test.ts` additionally imports host/Author test adapters from this checkout; the application build itself requires only Bun, Python and host GTK. Long-lived windows are never run with the bounded `chrona.exec` helper.
