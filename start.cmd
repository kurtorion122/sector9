@echo off
chcp 65001 >nul
title СЕКТОР-9 // локальный сервер
cd /d "%~dp0"
node serve.cjs
echo.
echo  Сервер остановлен. Нажмите любую клавишу для выхода...
pause >nul
