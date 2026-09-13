# Route3 Control (native Mac app)

A small AppKit + WebKit application that hosts the Route3 control center panel
on this Mac. It is a local supervisor for `control-center/server.js`, not a
separate product: everything the panel can do is defined by that server.

## Build

```bash
npm run mac                     # builds ~/Applications/Route3 Control.app
bash control-center/mac/build.sh --output /path/to/dir --open
bash control-center/mac/build.sh --check     # toolchain + source sanity check
```

Requirements: macOS 11+, Apple command line developer tools (`swiftc`), and
Node.js 18+ somewhere the app can find (see discovery order below).

## Ownership model

On launch the app polls `http://127.0.0.1:43173/api/health`:

- If a healthy server is already running, the app **attaches** to it and never
  stops it — not on reload, not on quit.
- If nothing is listening, the app starts `node control-center/server.js`
  itself. Only this owned server is stopped when the app quits (via the
  server's own SIGINT handling, which also stops jobs it started).

The status bar always states which case is active. `Restart Local Server`
restarts the owned server; with an external server it starts nothing and the
state stays visible. Server stdout/stderr is appended to
`~/Library/Logs/route3-control.log` (rotated past 1 MB), reachable from
*Server → Show Server Log in Finder*.

## Workspace

The server enforces that agent jobs run inside one configured workspace. The
app stores it in `route3Workspace` (defaults to the home directory) and passes
it as `--workspace`. *File → Choose Project Folder…* restarts the owned server
with the new folder; an externally started server keeps its own configuration.

## Node discovery

`kimi`-style CLIs and the server itself run on plain Node. The app looks for
`node` in this order: the inherited `PATH`, `/opt/homebrew/bin`,
`/usr/local/bin`, then the newest `~/.nvm/versions/node/*/bin/node`. Missing
Node is an explicit error state in the status bar, never a silent failure.

## Server script resolution

The bundled app tries, in order: the build-time `ROUTE3ServerJSPath` recorded
in `Info.plist`, `~/.local/share/route3/control-center/server.js` (created by
`route3-skill install`), then a repository checkout next to the bundle. If the
repository moves, reinstall or rebuild — the panel will say so rather than
guess.
