param([switch]$Check,[switch]$InstallFirewall)
$ErrorActionPreference='Stop'
$projectRoot=Split-Path -Parent $PSScriptRoot
$configPath=Join-Path $projectRoot 'config/default.json'
$config=Get-Content -Raw -LiteralPath $configPath | ConvertFrom-Json
$port=[int]$config.server.port
Write-Host "JoyLinkea-2 LAN: puerto TCP $port"
Get-NetConnectionProfile | Select-Object Name,InterfaceAlias,NetworkCategory,IPv4Connectivity | Format-Table
if ($Check) {
  Get-NetFirewallRule -DisplayName 'JoyLinkea-2 LAN' -ErrorAction SilentlyContinue | Select-Object DisplayName,Enabled,Profile,Action | Format-Table
  exit 0
}
if ($InstallFirewall) {
  $principal=New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
  if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Ejecutá este script como Administrador solo para instalar la regla de firewall.' }
  if (Get-NetFirewallRule -DisplayName 'JoyLinkea-2 LAN' -ErrorAction SilentlyContinue) { Write-Host 'La regla JoyLinkea-2 LAN ya existe. Revisala manualmente si cambió el puerto.'; exit 0 }
  New-NetFirewallRule -DisplayName 'JoyLinkea-2 LAN' -Direction Inbound -Action Allow -Protocol TCP -LocalPort $port -Profile Private | Out-Null
  Write-Host 'Regla propia creada para red privada.'
}
