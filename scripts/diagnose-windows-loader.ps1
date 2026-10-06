param([Parameter(Mandatory=$true)][string]$TargetDir)
$ErrorActionPreference = 'Stop'
$vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
$installation = & $vswhere -latest -products '*' -property installationPath
$dumpbin = Get-ChildItem "$installation\VC\Tools\MSVC\*\bin\Hostx64\x64\dumpbin.exe" | Sort-Object FullName -Descending | Select-Object -First 1
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class NativeImports {
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  public static extern IntPtr LoadLibraryW(string name);
  [DllImport("kernel32.dll", CharSet=CharSet.Ansi, ExactSpelling=true)]
  public static extern IntPtr GetProcAddress(IntPtr module, string name);
}
'@
$binaries = @("$TargetDir\easy-erp-desktop.exe") + @(Get-ChildItem "$TargetDir\deps\easy_erp_app-*.exe" | ForEach-Object FullName)
foreach ($binary in $binaries) {
  Write-Output "Checking imports: $binary"
  $module = [IntPtr]::Zero
  $library = ''
  foreach ($line in (& $dumpbin.FullName /imports $binary)) {
    if ($line -match '^\s+([^\s]+\.dll)\s*$') {
      $library = $Matches[1]
      $module = [NativeImports]::LoadLibraryW($library)
      if ($module -eq [IntPtr]::Zero) { Write-Output "LOAD FAILED: $library, Win32 error $([Runtime.InteropServices.Marshal]::GetLastWin32Error())" }
    } elseif ($module -ne [IntPtr]::Zero -and $line -match '^\s+[0-9A-Fa-f]+\s+([A-Za-z_?][^\s]*)\s*$') {
      $symbol = $Matches[1]
      if ([NativeImports]::GetProcAddress($module, $symbol) -eq [IntPtr]::Zero) { Write-Output "MISSING IMPORT: $library!$symbol" }
    }
  }
}
