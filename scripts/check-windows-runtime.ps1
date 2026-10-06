$ErrorActionPreference = 'Stop'
$vswhere = "${env:ProgramFiles(x86)}/Microsoft Visual Studio/Installer/vswhere.exe"
$installation = & $vswhere -latest -products '*' -property installationPath
$dumpbin = Get-ChildItem "$installation/VC/Tools/MSVC/*/bin/Hostx64/x64/dumpbin.exe" |
  Sort-Object FullName -Descending | Select-Object -First 1
if (-not $dumpbin) { throw 'MSVC import inspection tool not found.' }

$binaries = @(
  'desktop/target/x86_64-pc-windows-msvc/release/easy-erp-desktop.exe',
  'desktop/binaries/easy-erp-server-x86_64-pc-windows-msvc.exe',
  'target/x86_64-pc-windows-msvc/release/easy-erp-server.exe'
)
foreach ($binary in $binaries) {
  if (-not (Test-Path $binary)) { throw "Missing release binary: $binary" }
  # /imports includes regular and delay-loaded DLLs. Windows system/UCRT DLLs
  # are allowed; separately installed Visual C++ redistributable DLLs are not.
  $imports = & $dumpbin.FullName /imports $binary
  if ($LASTEXITCODE -ne 0) { throw "Cannot inspect imports: $binary" }
  $externalRuntime = @($imports | Select-String -Pattern '^\s*(vcruntime|msvcp|concrt|msvcr)\d[^\s]*\.dll\s*$')
  if ($externalRuntime.Count) {
    throw "Release depends on external Visual C++ runtime: $binary`n$($externalRuntime -join "`n")"
  }
  Write-Output "PASS: no external Visual C++ runtime dependency in $binary"
}
