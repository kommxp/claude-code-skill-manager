# Skill Manager 一键启动脚本 (PowerShell)

$PORT = 3200
$DIR = Split-Path -Parent $MyInvocation.MyCommand.Path

# 检查端口占用
$portInUse = Get-NetTCPConnection -LocalPort $PORT -ErrorAction SilentlyContinue
if ($portInUse) {
    Write-Host "⚠️  端口 $PORT 被占用，尝试释放..." -ForegroundColor Yellow
    $portInUse | ForEach-Object {
        Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue
    }
    Start-Sleep 1
}

# 检查依赖
if (-not (Test-Path "$DIR\node_modules")) {
    Write-Host "📦 安装后端依赖..." -ForegroundColor Cyan
    Set-Location $DIR
    npm install
}

if (-not (Test-Path "$DIR\client\node_modules")) {
    Write-Host "📦 安装前端依赖..." -ForegroundColor Cyan
    Set-Location "$DIR\client"
    npm install --legacy-peer-deps
}

# 检查前端构建产物
if (-not (Test-Path "$DIR\dist\index.html")) {
    Write-Host "🔨 构建前端..." -ForegroundColor Cyan
    Set-Location "$DIR\client"
    npm run build
}

# 启动服务并打开浏览器
Set-Location $DIR
Write-Host ""
Start-Process "http://localhost:$PORT"
node server/index.js
