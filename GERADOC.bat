@echo off
chcp 65001 >nul
title GERADOC
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [GERADOC] Node.js nao encontrado. Instale a versao LTS em https://nodejs.org e tente de novo.
  pause
  exit /b 1
)

rem Node 20 ou superior.
node -e "process.exit(Number(process.versions.node.split('.')[0]) >= 20 ? 0 : 1)"
if errorlevel 1 (
  for /f %%v in ('node -v') do echo [GERADOC] Seu Node.js e o %%v, mas o GERADOC precisa da versao 20 ou superior.
  echo [GERADOC] Instale a versao LTS em https://nodejs.org e tente de novo.
  pause
  exit /b 1
)

rem Instala as dependencias na primeira vez ou quando uma versao nova do GERADOC precisar de outras.
node -e "const p=require('./package.json');const fs=require('fs');process.exit(Object.keys(p.dependencies).every(d=>fs.existsSync('node_modules/'+d+'/package.json'))?0:1)"
if errorlevel 1 (
  echo [GERADOC] Instalando dependencias (so acontece na primeira vez ou depois de atualizar^)...
  call npm install --omit=dev
  if errorlevel 1 (
    echo [GERADOC] Falha ao instalar dependencias. Verifique a internet e tente de novo.
    pause
    exit /b 1
  )
  rem Atalho com icone na Area de Trabalho - recria se ja existir.
  powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "scripts\criar-atalho.ps1" >nul 2>nul
  if not errorlevel 1 echo [GERADOC] Atalho GERADOC criado na Area de Trabalho.
)

node src\servidor.js
if errorlevel 1 pause
