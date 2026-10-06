param(
  [Parameter(Mandatory=$true)][string]$InstallDir,
  [Parameter(Mandatory=$true)][string]$BackupTool
)
$ErrorActionPreference = 'Stop'
$appPath = [IO.Path]::GetFullPath((Join-Path $InstallDir 'easy-erp-desktop.exe'))
$serverPath = [IO.Path]::GetFullPath((Join-Path $InstallDir 'easy-erp-server.exe'))
$data = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'com.aspeed.easy-erp/server'
$config = Join-Path ([Environment]::GetFolderPath('ApplicationData')) 'com.aspeed.easy-erp'
$stoppedService = $false

function LocalRequest([string]$Method, [string]$Path, [string]$Token = '') {
  $request = [Net.HttpWebRequest]::Create("http://127.0.0.1:4280$Path")
  $request.Proxy = $null
  $request.AllowAutoRedirect = $false
  $request.Timeout = 120000
  $request.Method = $Method
  $request.Headers.Add('X-ERP-Request', '1')
  if ($Token) { $request.Headers.Add('Authorization', "Bearer $Token") }
  if ($Method -eq 'POST') { $request.ContentLength = 0 }
  $response = $request.GetResponse()
  try {
    $reader = [IO.StreamReader]::new($response.GetResponseStream())
    try { return ($reader.ReadToEnd() | ConvertFrom-Json) } finally { $reader.Dispose() }
  } finally { $response.Dispose() }
}

try {
  # Match full executable paths, never terminate every process with a shared name.
  $running = @(Get-CimInstance Win32_Process -Filter "Name='easy-erp-server.exe' OR Name='easy-erp-desktop.exe'")
  $servers = @($running | Where-Object { $_.ExecutablePath -eq $serverPath } |
    ForEach-Object { Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue })
  $apps = @($running | Where-Object { $_.ExecutablePath -eq $appPath } |
    ForEach-Object { Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue })
  # Open process handles now, so PID reuse cannot change the targets later.
  foreach ($process in @($servers) + @($apps)) { $null = $process.Handle }
  if ($servers.Count) {
    $identity = [IO.File]::ReadAllText((Join-Path $data 'instance-id')).Trim()
    $token = [IO.File]::ReadAllText((Join-Path $data 'desktop-control-token')).Trim()
    $status = LocalRequest 'GET' '/api/status'
    if ($status.instance_id -ne $identity) { throw '本机端口不属于这套库存，已停止安装。' }
    $null = New-Item -ItemType Directory -Force -Path $config
    [IO.File]::WriteAllText((Join-Path $config 'resume-service-after-update'), '1')
    $result = LocalRequest 'POST' '/api/desktop/prepare-update' $token
    if ($result.instance_id -ne $identity) { throw '备份返回的库存身份不匹配。' }
    $stoppedService = $true
    foreach ($process in $servers) {
      if (-not $process.WaitForExit(30000)) { throw '库存服务尚未退出，已停止安装，请稍后重试。' }
    }
  }
  # All committed writes have drained and the service has backed up/exited.
  # The installer's confirmation page asks users to save unfinished edits first.
  foreach ($process in $apps) {
    if (-not $process.HasExited) { $process.Kill() }
    if (-not $process.WaitForExit(10000)) { throw '桌面程序尚未退出，已停止安装。' }
  }
  # Covers offline databases too; holds the same directory lock, runs no migrations,
  # and produces the same standard ZIP format as the application's backup page.
  & $BackupTool --backup-only --data-dir $data
  if ($LASTEXITCODE -ne 0) { throw '安装前备份失败，尚未替换程序文件。' }
  Write-Output '库存已备份，旧程序已关闭，可以安全安装。'
} catch {
  if (($stoppedService -or $apps.Count -or (Test-Path (Join-Path $config 'resume-service-after-update'))) -and (Test-Path $appPath)) {
    Start-Process -FilePath $appPath
  }
  Write-Output $_.Exception.Message
  exit 1
}
