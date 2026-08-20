#!/usr/bin/env bash
# 双击即可停止服务并清除构建缓存（不动浏览器里的相册数据）。
cd "$(dirname "$0")" || exit 1
bash scripts/dev.sh stop
bash scripts/dev.sh clean
echo
echo "可以关闭这个窗口了。"
