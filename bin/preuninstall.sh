#!/bin/sh
DIR=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
cd "$HOME" >/dev/null 2>&1 || cd / >/dev/null 2>&1 || true
exec node "$DIR/route3-skill.js" uninstall --quiet
