#!/usr/bin/env bash
# 双击即可停止本地服务。
cd "$(dirname "$0")" || exit 1
bash scripts/dev.sh stop
echo
echo "可以关闭这个窗口了。"
