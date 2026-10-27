@echo off
setlocal
cd /d "%~dp0"
where pnpm >nul 2>nul
if errorlevel 1 (
  echo [FluentSSH] 需要安装 Node.js 20+ 与 pnpm：https://pnpm.io/installation
  pause
  exit /b 1
)
if not exist node_modules (
  echo [FluentSSH] 正在安装依赖...
  call pnpm install || goto :error
)
if not exist web\dist\index.html (
  echo [FluentSSH] 正在构建界面...
  call pnpm build || goto :error
)
echo [FluentSSH] 正在启动，浏览器将打开 http://127.0.0.1:4317
start "" cmd /c "timeout /t 2 >nul & start http://127.0.0.1:4317"
call pnpm start
exit /b 0

:error
echo [FluentSSH] 启动失败，请查看上方错误信息。
pause
exit /b 1
