@echo off
chcp 65001 >nul
cd /d "%~dp0"
powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "scripts\criar-atalho.ps1"
if errorlevel 1 (
  echo Nao foi possivel criar o atalho.
) else (
  echo Atalho GERADOC criado na Area de Trabalho.
)
pause
