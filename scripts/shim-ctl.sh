#!/usr/bin/env bash
# AIEA host AI shim controller — start / stop / status.
#
# The shim (scripts/host-ai-shim.mjs) must run on the host because it drives
# the host's logged-in claude / gemini CLIs. `pixi run up` calls this so the
# shim comes up alongside the containers; `pixi run down` stops it.
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PID_FILE="$ROOT/.aiea-shim.pid"
LOG_FILE="$ROOT/.aiea-shim.log"
SHIM="$ROOT/scripts/host-ai-shim.mjs"

is_running() {
  [ -f "$PID_FILE" ] || return 1
  local pid
  pid="$(cat "$PID_FILE" 2>/dev/null)"
  [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null
}

start() {
  if is_running; then
    echo "AIEA shim already running (pid $(cat "$PID_FILE"))"
    return 0
  fi
  if ! command -v node >/dev/null 2>&1; then
    echo "AIEA shim: \`node\` not on PATH — skipped (subscription providers will be offline)"
    return 0
  fi
  nohup node "$SHIM" >"$LOG_FILE" 2>&1 &
  echo $! >"$PID_FILE"
  sleep 0.5
  if is_running; then
    echo "AIEA shim started (pid $(cat "$PID_FILE")) — http://localhost:4023"
  else
    echo "AIEA shim failed to start — see $LOG_FILE"
    rm -f "$PID_FILE"
  fi
  return 0
}

stop() {
  if is_running; then
    local pid
    pid="$(cat "$PID_FILE")"
    kill "$pid" 2>/dev/null
    rm -f "$PID_FILE"
    echo "AIEA shim stopped (pid $pid)"
  else
    echo "AIEA shim not running"
    rm -f "$PID_FILE"
  fi
  return 0
}

case "${1:-status}" in
  start) start ;;
  stop) stop ;;
  restart)
    stop
    start
    ;;
  status)
    if is_running; then
      echo "running (pid $(cat "$PID_FILE"))"
    else
      echo "stopped"
    fi
    ;;
  *)
    echo "usage: shim-ctl.sh {start|stop|restart|status}"
    exit 1
    ;;
esac
