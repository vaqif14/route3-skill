#!/usr/bin/env bash
# Scope audit: every changed file must trace to the intent contract.
# Usage:
#   check-scope.sh --lock [--root DIR] [--state DIR]  # freeze INTENT scope + snapshot baseline
#   check-scope.sh --gate [--root DIR] [--state DIR]  # Stop-hook mode: locked scope vs baseline
#   check-scope.sh --mark [--root DIR]                # snapshot only (no intent lock)
#   check-scope.sh [--intent FILE] [--allow GLOBS] [--forbid GLOBS]
#                  [--git | --since SNAPSHOT | --changed LISTFILE] [--root DIR]
# INTENT lines read: `ALLOW: a/**, b.txt` and `FORBID: c/**` (repeatable; list
# bullets, bold and backticks tolerated). Globs: `*` stays in one directory,
# `**` crosses directories, `dir/` or `dir/**` is the whole subtree. ALLOW that
# covers the whole tree (`**`, `*`, `.`) is rejected.
# Source of changes: --changed list > --git > --since snapshot > baseline snapshot
# if present > git if repo. --gate always uses the locked baseline snapshot.
# Exit 0 in scope | 1 out of scope, lock broken or scope too broad | 2 bad args / no source.
set -euo pipefail

ROOT="."
STATE=".workflow/route3"
INTENT=""
ALLOW=""
FORBID=""
MODE=""
GATE=0
MARKER=""
LIST=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --mark) MODE="mark"; shift ;;
    --lock) MODE="lock"; shift ;;
    --gate) GATE=1; shift ;;
    --root) ROOT="$2"; shift 2 ;;
    --state) STATE="$2"; shift 2 ;;
    --intent) INTENT="$2"; shift 2 ;;
    --allow) ALLOW="$ALLOW,$2"; shift 2 ;;
    --forbid) FORBID="$FORBID,$2"; shift 2 ;;
    --git) MODE="git"; shift ;;
    --since) MODE="since"; MARKER="$2"; shift 2 ;;
    --changed) MODE="list"; LIST="$2"; shift 2 ;;
    -h|--help) sed -n 2,15p "$0" >&2; exit 2 ;;
    *) echo "check-scope: unknown arg: $1" >&2; exit 2 ;;
  esac
done

cd "$ROOT"
DEFAULT_MARKER="$STATE/SCOPE_START"
LOCK="$STATE/INTENT_LOCK"

if [[ "$GATE" -eq 1 ]]; then
  # The gate trusts only what was frozen at lock time — never an agent-written list.
  [[ -z "$MODE" && -z "$ALLOW$FORBID$INTENT" ]] \
    || { echo "check-scope: --gate takes no source, intent or glob overrides" >&2; exit 2; }
  MODE="since"; MARKER="$DEFAULT_MARKER"
fi
if [[ -z "$MODE" ]]; then
  if [[ -f "$DEFAULT_MARKER" ]]; then
    MODE="since"; MARKER="$DEFAULT_MARKER"
  elif git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    MODE="git"
  else
    echo "check-scope: no change source (not git; run --lock/--mark at start or pass --changed)" >&2
    exit 2
  fi
fi
[[ "$MODE" == "mark" || "$MODE" == "lock" ]] && MARKER="$DEFAULT_MARKER"
if [[ -z "$INTENT" && -f "$STATE/INTENT.md" ]]; then
  INTENT="$STATE/INTENT.md"
fi
if [[ "$MODE" == "lock" || "$GATE" -eq 1 ]]; then
  [[ -n "$INTENT" ]] || { echo "SCOPE FAIL: no $STATE/INTENT.md to lock or gate" ; exit 1; }
fi
if [[ "$GATE" -eq 1 && ! -f "$LOCK" ]]; then
  echo "SCOPE FAIL: INTENT.md exists but scope was never locked (run check-scope.sh --lock before dispatch)"
  exit 1
fi
[[ -z "$INTENT" || -f "$INTENT" ]] || { echo "check-scope: intent not found: $INTENT" >&2; exit 2; }
[[ "$MODE" != "list" || -f "$LIST" ]] || { echo "check-scope: list not found: $LIST" >&2; exit 2; }
[[ "$MODE" != "since" || -f "$MARKER" ]] || { echo "check-scope: snapshot not found: $MARKER" >&2; exit 2; }

GITLIST=""
if [[ "$MODE" == "git" ]]; then
  # No pathspec: changes outside --root must surface as ../ paths, not vanish.
  GITLIST=$(git -c color.status=false -c core.quotePath=false \
    status --short --untracked-files=all | sed -E 's/^.{3}//; s/^.* -> //; s/^"(.*)"$/\1/')
fi

MODE="$MODE" GATE="$GATE" MARKER="$MARKER" LOCK="$LOCK" LIST="$LIST" INTENT="$INTENT" \
ALLOW="$ALLOW" FORBID="$FORBID" GITLIST="$GITLIST" STATE="$STATE" python3 - <<'PY'
import hashlib, os, re, sys, time

E = os.environ
mode, marker, lock = E["MODE"], E["MARKER"], E["LOCK"]
gate = E["GATE"] == "1"
SKIP_DIRS = {".git", "node_modules", ".workflow"}
NOW = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

# `ALLOW:`, `- ALLOW:`, `**ALLOW:**`, `> FORBID:` — markdown decoration tolerated,
# glob characters in the value kept intact. Uppercase only, so a verbatim
# REQUEST line such as "Allow: ..." is never read as scope.
KEY = re.compile(r"^[\s>+-]*(?:\*\*|\*)?\s*(ALLOW|FORBID)\s*(?:\*\*)?\s*:\s*(?:\*\*(?=\s))?\s*(.*)$")

def globs(raw):
    return [g.strip().strip("`") for g in raw.split(",") if g.strip().strip("`")]

intent_allow, intent_forbid = [], []
if E["INTENT"]:
    for line in open(E["INTENT"]):
        m = KEY.match(line.rstrip("\n"))
        if m:
            (intent_allow if m.group(1) == "ALLOW" else intent_forbid).extend(globs(m.group(2)))
allow_list = intent_allow + globs(E["ALLOW"])
forbid_list = intent_forbid + globs(E["FORBID"])

def glob_re(pat):
    if pat.endswith("/"):
        pat += "**"
    out, i = "", 0
    while i < len(pat):
        if pat.startswith("**/", i):
            out += "(?:.*/)?"; i += 3
        elif pat.startswith("**", i):
            out += ".*"; i += 2
        elif pat[i] == "*":
            out += "[^/]*"; i += 1
        elif pat[i] == "?":
            out += "[^/]"; i += 1
        else:
            out += re.escape(pat[i]); i += 1
    if pat.endswith("/**"):
        out = out[: -len("/.*")] + "(?:/.*)?"
    return re.compile(out + r"\Z")

def match(path, pats):
    return any(p.fullmatch(path) for p in pats)

def scope_hash():
    body = "ALLOW=" + "\n".join(sorted(intent_allow)) + "\nFORBID=" + "\n".join(sorted(intent_forbid))
    return hashlib.sha256(body.encode()).hexdigest()

# A glob that matches both a top-level and a deeply nested arbitrary file covers
# the whole tree — that is "no scope", not a scope.
broad = [g for g in allow_list
         if g in ("*", ".", "./", "/") or (glob_re(g).fullmatch("zz_probe.bin")
                                            and glob_re(g).fullmatch("zz_a/zz_b/zz_probe.bin"))]
if broad:
    print(f"SCOPE FAIL: ALLOW too broad ({', '.join(broad)}) — name the files or directories the task needs")
    sys.exit(1)

def snapshot():
    snap = {}
    for dirpath, dirs, files in os.walk("."):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
        for f in files:
            p = os.path.join(dirpath, f)[2:]
            try:
                st = os.lstat(p)
            except OSError:
                continue
            snap[p] = f"{st.st_size}:{st.st_mtime_ns}"
    return snap

def write_snapshot():
    os.makedirs(os.path.dirname(marker) or ".", exist_ok=True)
    snap = snapshot()
    with open(marker, "w") as fh:
        fh.write(f"SCOPE_SNAPSHOT v2 {NOW}\n")
        for p in sorted(snap):
            fh.write(f"{snap[p]}\t{p}\n")
    return len(snap)

if mode == "mark":
    print(f"SCOPE MARK: {marker} ({write_snapshot()} files)")
    sys.exit(0)

if mode == "lock":
    if not intent_allow:
        print("SCOPE FAIL: INTENT.md has no ALLOW line — declare the scope before locking")
        sys.exit(1)
    n = write_snapshot()
    stamp = f"INTENT_LOCK v1 at={NOW} sha256={scope_hash()}"
    with open(lock, "w") as fh:
        fh.write(stamp + "\n")
    with open(lock + ".log", "a") as fh:
        fh.write(stamp + "\n")
    relocks = sum(1 for _ in open(lock + ".log"))
    print(f"SCOPE LOCK: {stamp} baseline={n} files" + (f" (lock #{relocks})" if relocks > 1 else ""))
    sys.exit(0)

if gate:
    stamp = open(lock).read().strip()
    m = re.search(r"sha256=([0-9a-f]{64})", stamp)
    if not m or m.group(1) != scope_hash():
        print("SCOPE FAIL: INTENT.md ALLOW/FORBID changed after the lock — scope widening needs "
              "the user's approval, then re-run check-scope.sh --lock (every re-lock is logged)")
        sys.exit(1)
    if not intent_allow:
        print("SCOPE FAIL: locked INTENT.md has no ALLOW line")
        sys.exit(1)
    try:
        relocks = sum(1 for _ in open(lock + ".log"))
    except OSError:
        relocks = 1
    if relocks > 1:
        print(f"SCOPE NOTE: scope was locked {relocks} times — report each widening to the user")

deleted = set()
if mode == "list":
    paths = [l.strip() for l in open(E["LIST"]) if l.strip()]
elif mode == "git":
    paths = [l for l in E["GITLIST"].splitlines() if l.strip()]
else:
    lines = open(marker).read().splitlines()
    now = snapshot()
    if lines and lines[0].startswith("SCOPE_SNAPSHOT v2"):
        before = {}
        for l in lines[1:]:
            sig, _, p = l.partition("\t")
            before[p] = sig
        paths = [p for p, sig in now.items() if before.get(p) != sig]
        deleted = {p for p in before if p not in now}
        paths += sorted(deleted)
    else:  # legacy timestamp marker: modification time only
        ref = os.stat(marker).st_mtime_ns
        paths = [p for p in now if os.lstat(p).st_mtime_ns > ref]

allow, forbid = [glob_re(g) for g in allow_list], [glob_re(g) for g in forbid_list]
# Leftovers agents commonly leave behind (debug scripts, logs, editor/OS junk).
scratch = [glob_re(g) for g in ["**/*.log", "**/*.tmp", "**/*.bak", "**/*.orig",
           "**/*.rej", "**/*~", "**/*.swp", "**/.DS_Store", "**/debug_*", "**/scratch*"]]

paths = sorted({os.path.normpath(p) for p in paths})
paths = [p for p in paths if not (p == ".workflow" or p.startswith(".workflow/"))]
if not allow:
    print("SCOPE WARN: no ALLOW globs; every change is untraced until scope is declared")
if not paths:
    print("SCOPE EMPTY: no changed files detected — confirm the task really needed no change")
    # Measured failure: an agent edited the wrong directory yet reported a verified fix.
    # At the gate, "nothing changed" must be declared, not assumed.
    if gate and not (E["INTENT"] and any(re.match(r"^[\s>*+-]*NO_CHANGE\s*:\s*\S", l)
                                         for l in open(E["INTENT"]))):
        print("SCOPE FAIL: route finished with no change inside the locked tree — if that is correct, "
              "add `NO_CHANGE: <reason>` to INTENT.md; otherwise the work landed somewhere else")
        sys.exit(1)
    sys.exit(0)

bad = 0
for p in paths:
    tag = "DELETED " if p in deleted else ""
    if p.startswith("../"):
        print(f"UNTRACED: {tag}{p} (outside --root)"); bad += 1
    elif match(p, forbid):
        print(f"FORBIDDEN: {tag}{p}"); bad += 1
    elif p not in allow_list and not tag and match(p, scratch):
        print(f"SCRATCH: {p}"); bad += 1
    elif not match(p, allow):
        print(f"UNTRACED: {tag}{p}"); bad += 1
    else:
        print(f"TRACED: {tag}{p}")

if bad:
    print(f"SCOPE FAIL: {bad} of {len(paths)} changed files outside the intent contract")
    sys.exit(1)
print(f"SCOPE OK: {len(paths)} changed files traced")
PY
