#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d)"
APP_NAME="my-app"
APP_DIR="$TMP_DIR/$APP_NAME"
DEV_LOG="$TMP_DIR/dev.log"
DEV_PID=""

cleanup() {
  if [[ -n "$DEV_PID" ]] && kill -0 "$DEV_PID" 2>/dev/null; then
    kill "$DEV_PID" 2>/dev/null || true
    wait "$DEV_PID" 2>/dev/null || true
  fi
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

elapsed() {
  local start="$1"
  local end
  end="$(date +%s)"
  echo "$((end - start))"
}

time_step() {
  local label="$1"
  shift
  local start
  start="$(date +%s)"
  "$@"
  printf "%-18s %ss\n" "$label" "$(elapsed "$start")"
}

export npm_config_user_agent="npm/10.0.0 node/v24.0.0 darwin x64"

cd "$TMP_DIR"
time_step "scaffold" node "$ROOT_DIR/packages/create-gmode/dist/bin.js" "$APP_NAME"

cd "$APP_DIR"
time_step "npm install" npm install

start="$(date +%s)"
npm run dev >"$DEV_LOG" 2>&1 &
DEV_PID="$!"

deadline=$((start + 120))
until curl -fsS "http://127.0.0.1:8787/__gmode/health" >/dev/null 2>&1; do
  if ! kill -0 "$DEV_PID" 2>/dev/null; then
    echo "npm run dev exited before readiness; log follows:" >&2
    cat "$DEV_LOG" >&2
    exit 1
  fi
  if [[ "$(date +%s)" -ge "$deadline" ]]; then
    echo "Timed out waiting for /__gmode/health; log follows:" >&2
    cat "$DEV_LOG" >&2
    exit 1
  fi
  sleep 1
done

printf "%-18s %ss\n" "npm run dev" "$(elapsed "$start")"
