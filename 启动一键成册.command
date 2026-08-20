#!/usr/bin/env bash
# 双击即可启动：Finder 里双击本文件，终端会起服务并自动打开浏览器。
cd "$(dirname "$0")" || exit 1
bash scripts/dev.sh start || exit 1
PORT="${PORT:-5173}"
open "http://localhost:$PORT/"
echo
echo "浏览器已打开。关闭这个终端窗口不会停止服务。"
echo "要停止请双击「关闭一键成册.command」。"
