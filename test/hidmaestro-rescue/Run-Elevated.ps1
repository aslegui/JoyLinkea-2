param(
  [Parameter(Mandatory=$true)]
  [ValidateSet('normal','crash-a','crash-rt','crash-stick','watchdog-crash')]
  [string]$Mode,
  [string]$RunLabel = ''
)
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$exe = Join-Path $PSScriptRoot 'bin\Debug\net10.0-windows\HidMaestroRescue.exe'
if (-not (Test-Path -LiteralPath $exe)) { throw 'Checkpoint harness not built' }
$cache = Join-Path $root '.native-cache'
$suffix = if ($RunLabel) { "-$RunLabel" } else { '' }
$stdout = Join-Path $cache "hmrescue-$Mode$suffix.stdout.log"
$stderr = Join-Path $cache "hmrescue-$Mode$suffix.stderr.log"
$result = Join-Path $cache "hmrescue-$Mode$suffix.exit.txt"
$checkpointExit = -1
try {
  & $exe --run $Mode 1> $stdout 2> $stderr
  $checkpointExit = $LASTEXITCODE
} catch {
  $checkpointExit = $LASTEXITCODE
  "PowerShellError=$($_.Exception.Message)" | Add-Content -LiteralPath $stderr
} finally {
  "ExitCode=$checkpointExit" | Set-Content -LiteralPath $result
}
if ($checkpointExit -ne 0) { exit $checkpointExit }
