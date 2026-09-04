# Hearth launcher for Windows. Right-click > Run with PowerShell, or: .\start.ps1
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

if (-not (Get-Command bun -ErrorAction SilentlyContinue)) {
  Write-Host "Bun isn't installed. Installing it now..." -ForegroundColor Yellow
  powershell -c "irm bun.sh/install.ps1 | iex"
  $env:Path = "$env:USERPROFILE\.bun\bin;$env:Path"
}

# Always sync; a new dependency in an updated build must not be skipped just
# because node_modules already exists.
Write-Host "Checking dependencies..." -ForegroundColor Yellow
bun install

bun run src/serve.ts
