$ErrorActionPreference = 'Stop'
$installer = (Get-ChildItem 'desktop/target/x86_64-pc-windows-msvc/release/bundle/nsis/*-setup.exe' | Select-Object -First 1).FullName
$installDir = Join-Path $env:RUNNER_TEMP 'easy-erp-install-test'
$data = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'com.aspeed.easy-erp/server'
$config = Join-Path ([Environment]::GetFolderPath('ApplicationData')) 'com.aspeed.easy-erp'
if (Test-Path $data) { throw 'Installer test requires a clean runner data directory.' }
$token = [Guid]::NewGuid().ToString('N') + [Guid]::NewGuid().ToString('N')
$session = [Microsoft.PowerShell.Commands.WebRequestSession]::new()
$base = 'http://127.0.0.1:4280'

function Install([string]$File, [string]$Flags = '/S') {
  $process = Start-Process -FilePath $File -ArgumentList "$Flags /D=$installDir" -PassThru
  if (-not $process.WaitForExit(180000)) { throw 'Installer did not finish.' }
  if ($process.ExitCode -ne 0) { throw "Installer failed: $($process.ExitCode)" }
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

$oldInstaller = Join-Path $env:RUNNER_TEMP 'easy-erp-0.1.2.exe'
Invoke-WebRequest 'https://github.com/7link-team/easy-erp/releases/download/v0.1.2/easy-erp-x86_64-pc-windows-msvc.exe' -OutFile $oldInstaller
Install $oldInstaller
$null = New-Item -ItemType Directory -Force -Path $data
[IO.File]::WriteAllText((Join-Path $data 'desktop-control-token'), $token)
$old = StartServer (Join-Path $installDir 'easy-erp-server.exe')
$identity = (Ready).instance_id
$null = Post '/api/setup' @{username='installer_test';password='Installer-test-2026';name='Installer test'}
$null = Post '/api/login' @{username='installer_test';password='Installer-test-2026'}
$null = Post '/api/items' @{name='installer-stock-sentinel';kind='原材料';unit='个';precision=0}

# Manual EXE upgrade, including a detached old service with no desktop UI.
Install $installer
if (-not $old.WaitForExit(10000)) { throw 'Old detached service still running.' }
$server = StartServer (Join-Path $installDir 'easy-erp-server.exe')
if ((Ready).instance_id -ne $identity) { throw 'Inventory identity changed.' }
AssertStock
if (@(Get-ChildItem "$data/backups/*.zip").Count -lt 2) { throw 'Live/offline upgrade backups missing.' }
Write-Output 'PASS: manual EXE upgrade stops old detached service and preserves inventory and login.'

# Match Tauri updater arguments and its authenticated preparation call.
$null = New-Item -ItemType Directory -Force -Path $config
[IO.File]::WriteAllText((Join-Path $config 'connection.json'), '{"mode":"local","server_url":"http://127.0.0.1:4280/"}')
[IO.File]::WriteAllText((Join-Path $config 'resume-service-after-update'), '1')
$null = Invoke-RestMethod "$base/api/desktop/prepare-update" -Method Post -Headers @{'X-ERP-Request'='1';Authorization="Bearer $token"}
if (-not $server.WaitForExit(30000)) { throw 'Update preparation did not stop service.' }
Install $installer '/S /UPDATE /R'
$null = Ready
AssertStock
$appPath = Join-Path $installDir 'easy-erp-desktop.exe'
$apps = @(Get-CimInstance Win32_Process -Filter "Name='easy-erp-desktop.exe'" | Where-Object ExecutablePath -eq $appPath)
if (-not $apps.Count) { throw 'Updater installer did not restart desktop app.' }
Write-Output 'PASS: automatic update installer restarts desktop/service with inventory preserved.'

# Uninstall must close the processes but must never remove business data.
$uninstall = Start-Process (Join-Path $installDir 'uninstall.exe') -ArgumentList '/S' -PassThru
if (-not $uninstall.WaitForExit(180000)) { throw 'Uninstall did not finish.' }
for ($i = 0; $i -lt 60 -and (Test-Path $appPath); $i++) { Start-Sleep -Milliseconds 500 }
if (Test-Path $appPath) { throw 'Uninstall did not remove program.' }
if (-not (Test-Path "$data/inventory.sqlite")) { throw 'Uninstall deleted inventory.' }
if (-not (Test-Path "$data/backups")) { throw 'Uninstall deleted backups.' }
[IO.File]::WriteAllText((Join-Path $data 'desktop-control-token'), $token)
$server = StartServer (Resolve-Path 'target/x86_64-pc-windows-msvc/release/easy-erp-server.exe').Path
AssertStock
$null = Invoke-RestMethod "$base/api/desktop/prepare-update" -Method Post -Headers @{'X-ERP-Request'='1';Authorization="Bearer $token"}
if (-not $server.WaitForExit(30000)) { throw 'Test service did not exit.' }
Write-Output 'PASS: uninstall preserves inventory, accounts, session and standard ZIP backups.'
