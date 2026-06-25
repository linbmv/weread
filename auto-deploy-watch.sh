#!/bin/bash
# 监控 backend 目录变化，自动提交推送
# 使用: ./auto-deploy-watch.sh

cd /root/distrobox/ai-env/github/weread

echo "👀 监控 backend/ 目录变化..."
echo "保存文件即自动部署！按 Ctrl+C 停止"

while true; do
  # 检查是否有变化
  if ! git diff --quiet backend/ || ! git diff --cached --quiet backend/; then
    echo "📝 检测到 backend/ 变化"

    # 自动提交
    git add backend/
    git commit -m "auto: 后端自动部署 $(date +'%Y-%m-%d %H:%M:%S')"

    # 自动推送
    git push origin main

    echo "✅ 已推送，GitHub Actions 正在部署..."
    sleep 5
  fi

  sleep 2
done
