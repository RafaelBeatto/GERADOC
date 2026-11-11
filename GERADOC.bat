@echo off
chcp 65001 >nul
title GERADOC
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [GERADOC] Node.js nao encontrado. Instale em https://nodejs.org e tente de novo.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo [GERADOC] Primeira execucao: instalando dependencias...
  call npm install --omit=dev
  if errorlevel 1 (
    echo [GERADOC] Falha ao instalar dependencias.
    pause
    exit /b 1
  )
)

node src\servidor.js
if errorlevel 1 pause
