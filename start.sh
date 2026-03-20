#!/bin/bash
# Skill Manager 一键启动脚本

PORT=3200
DIR="$(cd "$(dirname "$0")" && pwd)"

# 检查端口占用
if netstat -ano 2>/dev/null | grep -q ":$PORT "; then
  echo "⚠️  端口 $PORT 被占用，尝试释放..."
  npx kill-port $PORT 2>/dev/null
  sleep 1
fi

# 检查依赖
if [ ! -d "$DIR/node_modules" ]; then
  echo "📦 安装后端依赖..."
  cd "$DIR" && npm install
fi

if [ ! -d "$DIR/client/node_modules" ]; then
  echo "📦 安装前端依赖..."
  cd "$DIR/client" && npm install --legacy-peer-deps
fi

# 检查前端构建产物
if [ ! -f "$DIR/dist/index.html" ]; then
  echo "🔨 构建前端..."
  cd "$DIR/client" && npm run build
fi

# 启动服务
cd "$DIR"
echo ""
node server/index.js
