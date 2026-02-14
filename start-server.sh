#!/usr/bin/env bash
# start-server.sh — Start mcp-apple as an HTTP MCP server
#
# Usage:
#   ./start-server.sh          # Start in foreground
#   ./start-server.sh --bg     # Start in background (nohup)
#   ./start-server.sh --stop   # Stop background server
#   ./start-server.sh --status # Check if running
#
# Port: 8263 (MCP_APPLE_MAIL_PORT env var)
# Auth: Bearer token from MCP_APPLE_MAIL_TOKEN env var

set -euo pipefail

cd /Users/barton/Documents/dev/mcp-apple

PIDFILE=/tmp/mcp-apple-mail.pid
LOGFILE=/Users/barton/bin/logs/mcp-apple-mail.log

case "${1:-}" in
  --stop)
    if [[ -f "$PIDFILE" ]] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
      kill "$(cat "$PIDFILE")"
      rm -f "$PIDFILE"
      echo "Stopped."
    else
      echo "Not running."
      rm -f "$PIDFILE"
    fi
    ;;
  --status)
    if [[ -f "$PIDFILE" ]] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
      echo "Running (PID $(cat "$PIDFILE"))"
      curl -s http://127.0.0.1:8263/health 2>/dev/null || echo "Not responding on port 8263"
    else
      echo "Not running."
    fi
    ;;
  --bg)
    if [[ -f "$PIDFILE" ]] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
      echo "Already running (PID $(cat "$PIDFILE"))"
      exit 0
    fi
    nohup node dist/index.js >> "$LOGFILE" 2>&1 &
    echo $! > "$PIDFILE"
    sleep 2
    if curl -s http://127.0.0.1:8263/health > /dev/null 2>&1; then
      echo "Started (PID $!, health OK)"
    else
      echo "Started (PID $!) but health check failed — check $LOGFILE"
    fi
    ;;
  *)
    exec node dist/index.js
    ;;
esac
