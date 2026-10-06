$ErrorActionPreference = 'Stop'
$installer = (Get-ChildItem 'desktop/target/x86_64-pc-windows-msvc/release/bundle/nsis/*-setup.exe' | Select-Object -First 1).FullName
$installDir = Join-Path $env:ProgramFiles 'EasyERP'
$machineDir = $installDir
$userDir = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'Programs/EasyERP'
$legacyDir = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) '库存管理'
$uninstallKey = 'Software\Microsoft\Windows\CurrentVersion\Uninstall\库存管理'
$data = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'com.aspeed.easy-erp/server'
$config = Join-Path ([Environment]::GetFolderPath('ApplicationData')) 'com.aspeed.easy-erp'
if (Test-Path $data) { throw 'Installer test requires a clean runner data directory.' }
$token = [Guid]::NewGuid().ToString('N') + [Guid]::NewGuid().ToString('N')
$session = [Microsoft.PowerShell.Commands.WebRequestSession]::new()
$base = 'http://127.0.0.1:4280'

function Install([string]$File, [string]$Flags = '/S') {
  $process = Start-Process -FilePath $File -ArgumentList $Flags -PassThru
  if (-not $process.WaitForExit(180000)) { throw 'Installer did not finish.' }
  if ($process.ExitCode -ne 0) { throw "Installer failed: $($process.ExitCode)" }
}
function Uninstall([string]$Directory, [string]$Scope) {
  $process = Start-Process (Join-Path $Directory 'uninstall.exe') -ArgumentList "/S /$Scope" -PassThru
  if (-not $process.WaitForExit(180000)) { throw 'Uninstall did not finish.' }
  for ($i = 0; $i -lt 60 -and (Test-Path (Join-Path $Directory 'easy-erp-desktop.exe')); $i++) { Start-Sleep -Milliseconds 500 }
  if (Test-Path (Join-Path $Directory 'easy-erp-desktop.exe')) { throw 'Uninstall did not remove program.' }
}
function AssertInstallation([string]$Directory, [string]$Hive) {
  $entry = Get-ItemProperty "${Hive}:\$uninstallKey"
  if ($entry.InstallLocation.Trim('"') -ne $Directory) { throw "Incorrect installation location: $($entry.InstallLocation)" }
  if ($Directory -match '[^\x20-\x7E]') { throw 'Non-ASCII installation path.' }
  if (-not (Test-Path (Join-Path $Directory 'easy-erp-desktop.exe'))) { throw 'Installed desktop executable missing.' }
  $shell = New-Object -ComObject WScript.Shell
  $folder = if ($Hive -eq 'HKLM') { 'CommonPrograms' } else { 'Programs' }
  $link = Join-Path ([Environment]::GetFolderPath($folder)) '库存管理.lnk'
  if (-not (Test-Path $link) -or $shell.CreateShortcut($link).TargetPath -ne (Join-Path $Directory 'easy-erp-desktop.exe')) {
    throw 'Start menu shortcut does not point to the installed application.'
  }
}
function RejectInstall([string]$Flags) {
  $process = Start-Process -FilePath $installer -ArgumentList $Flags -PassThru
  if (-not $process.WaitForExit(180000)) { throw 'Rejected installer did not finish.' }
  if ($process.ExitCode -eq 0) { throw 'Unsafe installation was not rejected.' }
}
function Ready {
  for ($i = 0; $i -lt 120; $i++) {
    try { return Invoke-RestMethod "$base/api/status" -TimeoutSec 2 } catch { Start-Sleep -Milliseconds 500 }
  }
  throw 'Inventory service did not start.'
}
function StartServer([string]$Binary) {
  $info = [Diagnostics.ProcessStartInfo]::new($Binary)
  $info.UseShellExecute = $false
  $info.CreateNoWindow = $true
  $info.Arguments = '--data-dir "' + $data + '" --bind 127.0.0.1:4280'
  $info.EnvironmentVariables['ERP_DESKTOP_CONTROL_TOKEN'] = $token
  $child = [Diagnostics.Process]::Start($info)
  $null = Ready
  return $child
}
function Post([string]$Path, $Body) {
  Invoke-RestMethod "$base$Path" -Method Post -Headers @{'X-ERP-Request'='1'} -WebSession $session -ContentType 'application/json' -Body ($Body | ConvertTo-Json)
}
function AssertStock {
  $items = Invoke-RestMethod "$base/api/items" -WebSession $session
  if (@($items.items | Where-Object name -eq 'installer-stock-sentinel').Count -ne 1) { throw 'Inventory was not preserved.' }
}

# Fresh install must default to Program Files for all users, without /D or /AllUsers.
Install $installer
AssertInstallation $machineDir 'HKLM'
Uninstall $machineDir 'AllUsers'
if (Test-Path "$data/inventory.sqlite") { throw 'Installing alone must not create inventory.' }
Write-Output 'PASS: fresh install defaults to all users and Program Files/EasyERP.'

$oldInstaller = Join-Path $env:RUNNER_TEMP 'easy-erp-0.1.2.exe'
Invoke-WebRequest 'https://github.com/7link-team/easy-erp/releases/download/v0.1.2/easy-erp-x86_64-pc-windows-msvc.exe' -OutFile $oldInstaller
Install $oldInstaller
$null = New-Item -ItemType Directory -Force -Path $data
[IO.File]::WriteAllText((Join-Path $data 'desktop-control-token'), $token)
$old = StartServer (Join-Path $legacyDir 'easy-erp-server.exe')
$identity = (Ready).instance_id
$null = Post '/api/setup' @{username='installer_test';password='Installer-test-2026';name='Installer test'}
$null = Post '/api/login' @{username='installer_test';password='Installer-test-2026'}
$null = Post '/api/items' @{name='installer-stock-sentinel';kind='原材料';unit='个';precision=0}

# Upgrade retains current-user scope and migrates the old Chinese program directory.
Install $installer
AssertInstallation $userDir 'HKCU'
if (Test-Path (Join-Path $legacyDir 'easy-erp-desktop.exe')) { throw 'Legacy program was not migrated.' }
if (-not $old.WaitForExit(10000)) { throw 'Old detached service still running.' }
$server = StartServer (Join-Path $userDir 'easy-erp-server.exe')
if ((Ready).instance_id -ne $identity) { throw 'Inventory identity changed.' }
AssertStock
if (@(Get-ChildItem "$data/backups/*.zip").Count -lt 2) { throw 'Live/offline upgrade backups missing.' }
Write-Output 'PASS: manual EXE upgrade stops old detached service and preserves inventory and login.'

# Explicitly switching scope migrates the program, not the inventory directory.
Install $installer '/S /AllUsers'
AssertInstallation $machineDir 'HKLM'
if (Test-Path "HKCU:\$uninstallKey") { throw 'Duplicate per-user uninstall entry remains.' }
if (Test-Path (Join-Path $userDir 'easy-erp-desktop.exe')) { throw 'Old per-user program remains.' }
if (-not $server.WaitForExit(10000)) { throw 'Scope migration did not stop old service.' }
$server = StartServer (Join-Path $machineDir 'easy-erp-server.exe')
AssertStock
Write-Output 'PASS: migration from current user to all users preserves inventory and removes duplicate installation.'

# Match Tauri updater arguments and its authenticated preparation call.
$null = New-Item -ItemType Directory -Force -Path $config
[IO.File]::WriteAllText((Join-Path $config 'connection.json'), '{"mode":"local","server_url":"http://127.0.0.1:4280/"}')
[IO.File]::WriteAllText((Join-Path $config 'resume-service-after-update'), '1')
$null = Invoke-RestMethod "$base/api/desktop/prepare-update" -Method Post -Headers @{'X-ERP-Request'='1';Authorization="Bearer $token"}
if (-not $server.WaitForExit(30000)) { throw 'Update preparation did not stop service.' }
Install $installer '/S /UPDATE /R'
AssertInstallation $machineDir 'HKLM'
$null = Ready
AssertStock
$appPath = Join-Path $installDir 'easy-erp-desktop.exe'
$apps = @(Get-CimInstance Win32_Process -Filter "Name='easy-erp-desktop.exe'" | Where-Object ExecutablePath -eq $appPath)
if (-not $apps.Count) { throw 'Updater installer did not restart desktop app.' }
Write-Output 'PASS: automatic update installer restarts desktop/service with inventory preserved.'

# Uninstall must close the processes but must never remove business data.
Uninstall $installDir 'AllUsers'
if (-not (Test-Path "$data/inventory.sqlite")) { throw 'Uninstall deleted inventory.' }
if (-not (Test-Path "$data/backups")) { throw 'Uninstall deleted backups.' }
[IO.File]::WriteAllText((Join-Path $data 'desktop-control-token'), $token)
$server = StartServer (Resolve-Path 'target/x86_64-pc-windows-msvc/release/easy-erp-server.exe').Path
AssertStock
$null = Invoke-RestMethod "$base/api/desktop/prepare-update" -Method Post -Headers @{'X-ERP-Request'='1';Authorization="Bearer $token"}
if (-not $server.WaitForExit(30000)) { throw 'Test service did not exit.' }
Write-Output 'PASS: uninstall preserves inventory, accounts, session and standard ZIP backups.'

# Current-user is a real selectable installation mode and persists on updates.
Install $installer '/S /CurrentUser'
AssertInstallation $userDir 'HKCU'
Install $installer '/S /UPDATE'
AssertInstallation $userDir 'HKCU'
if (Test-Path "HKLM:\$uninstallKey") { throw 'Current-user update unexpectedly installed for all users.' }
Uninstall $userDir 'CurrentUser'
Write-Output 'PASS: current-user installation and automatic update preserve the selected scope.'

# Explicit ASCII paths survive updates; invalid paths must fail before copying files.
$customDir = Join-Path $env:RUNNER_TEMP 'EasyERP Custom Path'
Install $installer "/S /CurrentUser /D=$customDir"
AssertInstallation $customDir 'HKCU'
Install $installer '/S /UPDATE'
AssertInstallation $customDir 'HKCU'
$installedVersion = (Get-ItemProperty "HKCU:\$uninstallKey").DisplayVersion
Set-ItemProperty "HKCU:\$uninstallKey" -Name DisplayVersion -Value '99.0.0'
RejectInstall '/S /AllUsers'
AssertInstallation $customDir 'HKCU'
if (Test-Path "HKLM:\$uninstallKey") { throw 'Scope change bypassed downgrade protection.' }
Set-ItemProperty "HKCU:\$uninstallKey" -Name DisplayVersion -Value $installedVersion
Uninstall $customDir 'CurrentUser'
$invalidDir = Join-Path $env:RUNNER_TEMP '中文目录'
RejectInstall "/S /CurrentUser /D=$invalidDir"
if (Test-Path (Join-Path $invalidDir 'easy-erp-desktop.exe')) { throw 'Installed into a non-ASCII path.' }
Write-Output 'PASS: custom ASCII paths persist, Chinese paths and cross-scope downgrades are rejected.'
