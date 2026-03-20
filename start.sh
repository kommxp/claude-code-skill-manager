#!/bin/bash
# Skill Manager one-click startup script (Skill Manager 一键启动脚本)

PORT=3200
DIR="$(cd "$(dirname "$0")" && pwd)"

# Check port availability (检查端口占用)
if netstat -ano 2>/dev/null | grep -q ":$PORT "; then
  echo "Warning: Port $PORT is occupied, attempting to release..."
  npx kill-port $PORT 2>/dev/null
  sleep 1
fi

# Check dependencies (检查依赖)
if [ ! -d "$DIR/node_modules" ]; then
  echo "Installing backend dependencies..."
  cd "$DIR" && npm install
fi

if [ ! -d "$DIR/client/node_modules" ]; then
  echo "Installing frontend dependencies..."
  cd "$DIR/client" && npm install --legacy-peer-deps
fi

# Check frontend build output (检查前端构建产物)
if [ ! -f "$DIR/dist/index.html" ]; then
  echo "Building frontend..."
  cd "$DIR/client" && npm run build
fi

# Start server (启动服务)
cd "$DIR"
echo ""
node server/index.js
