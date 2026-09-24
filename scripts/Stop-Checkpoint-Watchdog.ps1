param([Parameter(Mandatory=$true)][int]$WatchdogPid,[Parameter(Mandatory=$true)][long]$StartTicks)
$ErrorActionPreference='Stop'
$process=Get-Process -Id $WatchdogPid -ErrorAction Stop
if ($process.ProcessName -ne 'dotnet' -or $process.StartTime.ToUniversalTime().Ticks -ne $StartTicks) { throw 'Checkpoint Watchdog process identity mismatch' }
Stop-Process -Id $WatchdogPid -ErrorAction Stop
