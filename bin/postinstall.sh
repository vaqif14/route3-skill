#!/bin/sh
# Resilient postinstall: ignore broken inherited cwd
cd / >/dev/null 2>&1 || true
DIR=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
exec node "$DIR/route3-skill.js" install --quiet
