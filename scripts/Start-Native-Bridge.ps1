param(
  [Parameter(Mandatory=$true)][ValidatePattern('^joylinkea2-[a-f0-9]{32}$')][string]$PipeName,
  [Parameter(Mandatory=$true)][ValidateRange(500,30000)][int]$WatchdogMs
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$dll = Join-Path $root 'bridge\native\bin\Debug\net10.0-windows\JoyLinkBridge.dll'
if (-not (Test-Path -LiteralPath $dll)) { throw 'Bridge nativo no compilado.' }
$dotnet = 'C:\Program Files\dotnet\dotnet.exe'
if (-not (Test-Path -LiteralPath $dotnet)) { throw '.NET 10 no encontrado.' }
$arguments = '"' + $dll + '" --pipe ' + $PipeName + ' ' + $WatchdogMs
$process = Start-Process -FilePath $dotnet -ArgumentList $arguments -Verb RunAs -WindowStyle Hidden -PassThru
Write-Output ('BRIDGE_PID=' + $process.Id)
Write-Output ('BRIDGE_START_TICKS=' + $process.StartTime.ToUniversalTime().Ticks)
