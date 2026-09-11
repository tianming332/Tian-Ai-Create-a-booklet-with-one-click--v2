#!/usr/bin/env bash
# One-click dev server control for AutoBook.
#   ./scripts/dev.sh start|stop|restart|status|clean|clean-all
# The server runs detached; its pid and log live in .dev/ so `stop` never has to
# guess which process to kill.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

RUN_DIR="$ROOT/.dev"
PID_FILE="$RUN_DIR/vite.pid"
LOG_FILE="$RUN_DIR/vite.log"
PORT="${PORT:-5173}"

running_pid() {
  [ -f "$PID_FILE" ] || return 1
  local pid
  pid="$(cat "$PID_FILE" 2>/dev/null || true)"
  [ -n "$pid" ] || return 1
  kill -0 "$pid" 2>/dev/null || return 1
  printf '%s' "$pid"
}

start() {
  if pid="$(running_pid)"; then
    echo "已在运行 (pid $pid) → http://localhost:$PORT/"
    return 0
  fi
  [ -d node_modules ] || { echo "安装依赖…"; npm install; }
  mkdir -p "$RUN_DIR"
  : >"$LOG_FILE"
  nohup npx vite --port "$PORT" >>"$LOG_FILE" 2>&1 </dev/null &
  echo $! >"$PID_FILE"
  # Vite prints its banner within a second or two; wait so failures surface here.
  for _ in $(seq 1 40); do
    if grep -q "ready in" "$LOG_FILE" 2>/dev/null; then break; fi
    if ! kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
      echo "启动失败，日志："; cat "$LOG_FILE"; rm -f "$PID_FILE"; return 1
    fi
    sleep 0.25
  done
  echo "已启动 (pid $(cat "$PID_FILE")) → http://localhost:$PORT/"
  echo "日志：$LOG_FILE"
}

stop() {
  if pid="$(running_pid)"; then
    # Vite spawns no children of its own, but kill the group to be safe.
    kill "$pid" 2>/dev/null || true
    for _ in $(seq 1 20); do
      kill -0 "$pid" 2>/dev/null || break
      sleep 0.1
    done
    kill -9 "$pid" 2>/dev/null || true
    rm -f "$PID_FILE"
    echo "已停止 (pid $pid)"
  else
    rm -f "$PID_FILE"
    echo "未在运行"
  fi
}

status() {
  if pid="$(running_pid)"; then
    echo "运行中 (pid $pid) → http://localhost:$PORT/"
  else
    echo "未在运行"
  fi
}

clean() {
  rm -rf dist node_modules/.vite .dev/vite.log
  rm -f tsconfig.tsbuildinfo
  echo "已清除构建缓存：dist、node_modules/.vite、tsconfig.tsbuildinfo"
  echo "浏览器里的项目数据（IndexedDB）请用界面「设置 → 清除本地缓存」清理。"
}

clean_all() {
  stop
  clean
  rm -rf node_modules
  echo "已删除 node_modules，下次 start 会自动重新安装。"
}

case "${1:-start}" in
  start) start ;;
  stop) stop ;;
  restart) stop; start ;;
  status) status ;;
  clean) clean ;;
  clean-all | clean:all) clean_all ;;
  *)
    echo "用法: $0 {start|stop|restart|status|clean|clean-all}" >&2
    exit 1
    ;;
esac
