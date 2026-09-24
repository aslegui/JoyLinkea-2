param(
  [Parameter(Mandatory=$true)][ValidateSet('controller','watchdog')][string]$Kind,
  [Parameter(Mandatory=$true)][int]$TargetPid,
  [Parameter(Mandatory=$true)][long]$StartTicks,
  [Parameter(Mandatory=$true)][ValidateRange(0,3)][int]$XInputSlot
)
$ErrorActionPreference='Stop'
$root=(Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$exe=Join-Path $PSScriptRoot 'bin\Debug\net10.0-windows\HidMaestroRescue.exe'
if(-not (Test-Path -LiteralPath $exe)){throw 'Checkpoint harness not built'}
$stdout=Join-Path $root ".native-cache\product-$Kind-timing.stdout.log"
$stderr=Join-Path $root ".native-cache\product-$Kind-timing.stderr.log"
$result=Join-Path $root ".native-cache\product-$Kind-timing.exit.txt"
$exitCode=1
try {
  & $exe --measure-external-kill $TargetPid $StartTicks $XInputSlot a 1> $stdout 2> $stderr
  $exitCode=$LASTEXITCODE
} catch {
  "PowerShellError=$($_.Exception.Message)" | Add-Content -LiteralPath $stderr
} finally {
  "ExitCode=$exitCode" | Set-Content -LiteralPath $result
}
if($exitCode -ne 0){exit $exitCode}
