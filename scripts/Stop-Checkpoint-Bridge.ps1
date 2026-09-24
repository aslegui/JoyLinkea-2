param([Parameter(Mandatory=$true)][int]$BridgePid,[Parameter(Mandatory=$true)][long]$StartTicks)
$ErrorActionPreference='Stop'
$process=Get-Process -Id $BridgePid -ErrorAction Stop
if ($process.ProcessName -ne 'dotnet' -or $process.StartTime.ToUniversalTime().Ticks -ne $StartTicks) { throw 'Checkpoint Bridge process identity mismatch' }
Stop-Process -Id $BridgePid -ErrorAction Stop
