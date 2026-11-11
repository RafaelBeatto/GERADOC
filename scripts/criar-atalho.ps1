# GERADOC - cria o atalho "GERADOC" (com icone) que abre o programa com a janela preta minimizada.
# Uso: powershell -NoProfile -ExecutionPolicy Bypass -File scripts\criar-atalho.ps1 [-Destino <pasta>]
# Sem -Destino, o atalho vai para a Area de Trabalho do usuario.
param([string]$Destino = '')

$ErrorActionPreference = 'Stop'
$raiz = Split-Path -Parent $PSScriptRoot
if (-not $Destino) { $Destino = [Environment]::GetFolderPath('Desktop') }
if (-not (Test-Path -LiteralPath $Destino -PathType Container)) { throw "Pasta nao encontrada: $Destino" }

$arquivo = Join-Path $Destino 'GERADOC.lnk'
$shell = New-Object -ComObject WScript.Shell
$atalho = $shell.CreateShortcut($arquivo)
$atalho.TargetPath = Join-Path $raiz 'GERADOC.bat'
$atalho.WorkingDirectory = $raiz
$atalho.IconLocation = (Join-Path $raiz 'recursos\geradoc.ico') + ',0'
$atalho.WindowStyle = 7  # minimizada
$atalho.Description = 'GERADOC - gerador de documentos'
$atalho.Save()
Write-Output $arquivo
