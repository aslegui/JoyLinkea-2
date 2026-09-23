$ErrorActionPreference='Stop'
$projectRoot=Split-Path -Parent $PSScriptRoot
$cache=Join-Path $projectRoot '.native-cache'
New-Item -ItemType Directory -Force -Path $cache | Out-Null
$archive=Join-Path $cache 'HIDMaestro-v1.9.0.zip'
$expected='1FA4A57B6F2DB9DC943BB81047808FDF097955497B96F22C1944DDD961B59605'
if (-not (Test-Path -LiteralPath $archive)) {
  Invoke-WebRequest -Uri 'https://github.com/hifihedgehog/HIDMaestro/releases/download/v1.9.0/HIDMaestro-v1.9.0.zip' -OutFile $archive
}
$actual=(Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash
if ($actual -ne $expected) { throw "Hash inesperado de HIDMaestro: $actual" }
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip=[IO.Compression.ZipFile]::OpenRead($archive)
try {
  foreach($name in @('HIDMaestro.Core.dll','LICENSE','README.md')) {
    $entry=$zip.GetEntry($name)
    if ($null -eq $entry) { throw "Falta $name en el paquete" }
    [IO.Compression.ZipFileExtensions]::ExtractToFile($entry,(Join-Path $cache $name),$true)
  }
} finally { $zip.Dispose() }
Write-Host 'SDK extraído y verificado. No se instaló ningún driver.'
