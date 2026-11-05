#!/bin/sh
set -eu

if [ -z "$(printf '%s' "${API_KEY:-}" | tr -d '[:space:]')" ]; then
  echo 'API_KEY is required; set a non-empty key before starting Chrona.' >&2
  exit 1
fi

exec "$@"
