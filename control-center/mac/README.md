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
  server's own SIGTERM handling, which also stops jobs it started).

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

The app augments Finder’s limited PATH with common user CLI directories,
Homebrew and NVM installations, sorting NVM versions numerically. The selected
Node directory is first in the child process PATH. Missing Node is an explicit
error state. A responding port is reused only when its JSON health response
identifies Route3; unrelated services are never attached or stopped.

## Server script resolution

The bundled app tries, in order: the build-time `ROUTE3ServerJSPath` recorded
in `Info.plist`, `~/.local/share/route3/control-center/server.js` (created by
`route3-skill install`), then a repository checkout next to the bundle. If the
repository moves, reinstall or rebuild — the panel will say so rather than
guess.

Builds run native self-checks, validate the plist and sign the bundle before
replacing the installed app. The previous app is retained under the output
directory’s `.route3-backups/` folder. A compile failure leaves it intact.
