#!/bin/sh
# Resolve package bin dir BEFORE any cd (supports broken inherited cwd).
DIR=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
cd "$HOME" >/dev/null 2>&1 || cd / >/dev/null 2>&1 || true
exec node "$DIR/route3-skill.js" install --quiet
