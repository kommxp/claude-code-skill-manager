# Skill Manager one-click startup script (PowerShell) (Skill Manager 一键启动脚本 (PowerShell))

$PORT = 3200
$DIR = Split-Path -Parent $MyInvocation.MyCommand.Path

# Check port availability (检查端口占用)
$portInUse = Get-NetTCPConnection -LocalPort $PORT -ErrorAction SilentlyContinue
if ($portInUse) {
    Write-Host "Warning: Port $PORT is occupied, attempting to release..." -ForegroundColor Yellow
    $portInUse | ForEach-Object {
        Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue
    }
    Start-Sleep 1
}

# Check dependencies (检查依赖)
if (-not (Test-Path "$DIR\node_modules")) {
    Write-Host "Installing backend dependencies..." -ForegroundColor Cyan
    Set-Location $DIR
    npm install
}

if (-not (Test-Path "$DIR\client\node_modules")) {
    Write-Host "Installing frontend dependencies..." -ForegroundColor Cyan
    Set-Location "$DIR\client"
    npm install --legacy-peer-deps
}

# Check frontend build output (检查前端构建产物)
if (-not (Test-Path "$DIR\dist\index.html")) {
    Write-Host "Building frontend..." -ForegroundColor Cyan
    Set-Location "$DIR\client"
    npm run build
}

# Start server and open browser (启动服务并打开浏览器)
Set-Location $DIR
Write-Host ""
Start-Process "http://localhost:$PORT"
node server/index.js
