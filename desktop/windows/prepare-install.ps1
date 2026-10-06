param(
  [Parameter(Mandatory=$true)][string]$InstallDir,
  [Parameter(Mandatory=$true)][string]$BackupTool,
  [ValidateSet('Install', 'Uninstall')][string]$Operation = 'Install',
  [ValidateSet('Prepare', 'Finalize')][string]$Phase = 'Prepare',
  [ValidateSet('AllUsers', 'CurrentUser')][string]$InstallScope = 'CurrentUser',
  [string]$StateFile
)
$ErrorActionPreference = 'Stop'
$appPath = [IO.Path]::GetFullPath((Join-Path $InstallDir 'easy-erp-desktop.exe'))
$restartApp = $appPath
$data = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'com.aspeed.easy-erp/server'
$config = Join-Path ([Environment]::GetFolderPath('ApplicationData')) 'com.aspeed.easy-erp'
$stoppedService = $false
$stoppedApp = $false
$apps = @()
$installRoot = [IO.Path]::GetFullPath($InstallDir).TrimEnd('\')
$uninstallKey = 'Software\Microsoft\Windows\CurrentVersion\Uninstall\库存管理'

function InstalledCopies {
  foreach ($hive in @('HKCU', 'HKLM')) {
    $key = "${hive}:\$uninstallKey"
    $entry = Get-ItemProperty -LiteralPath $key -ErrorAction SilentlyContinue
    if ($entry -and $entry.MainBinaryName -eq 'easy-erp-desktop.exe' -and $entry.InstallLocation) {
      $root = [IO.Path]::GetFullPath($entry.InstallLocation.Trim('"')).TrimEnd('\')
      if ($root -eq [IO.Path]::GetPathRoot($root).TrimEnd('\')) { throw '旧程序安装目录无效。' }
      [pscustomobject]@{ Root = $root; Key = $key }
    }
  }
}

function FinalizeMigration {
  if (-not $StateFile -or -not (Test-Path -LiteralPath $StateFile)) { throw '缺少程序迁移记录。' }
  $copies = @(Get-Content -LiteralPath $StateFile -Raw | ConvertFrom-Json | Where-Object { $_ -and $_.Root })
  foreach ($copy in $copies) {
    if ($copy.Root -eq $installRoot) { continue }
    $oldApp = Join-Path $copy.Root 'easy-erp-desktop.exe'
    # Only remove the exact known program files, never recurse into a directory.
    foreach ($name in @('easy-erp-desktop.exe', 'easy-erp-server.exe', 'uninstall.exe')) {
      $file = Join-Path $copy.Root $name
      if (Test-Path -LiteralPath $file) { Remove-Item -LiteralPath $file -Force }
    }
    if ((Test-Path -LiteralPath $copy.Root) -and -not (Get-ChildItem -LiteralPath $copy.Root -Force)) {
      [IO.Directory]::Delete($copy.Root)
    }
    # The new scope's registry entry has already been written: never delete it.
    $entry = Get-ItemProperty -LiteralPath $copy.Key -ErrorAction SilentlyContinue
    if ($entry -and $entry.InstallLocation.Trim('"') -eq $copy.Root) {
      Remove-Item -LiteralPath $copy.Key -Recurse
    }
    $runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
    $auto = (Get-ItemProperty -LiteralPath $runKey -ErrorAction SilentlyContinue).'库存管理'
    if ($auto -and ($auto -eq $oldApp -or $auto.StartsWith('"' + $oldApp + '"', [StringComparison]::OrdinalIgnoreCase))) {
      Set-ItemProperty -LiteralPath $runKey -Name '库存管理' -Value ($auto.Replace($oldApp, $appPath))
    }
    $shell = New-Object -ComObject WScript.Shell
    foreach ($folder in @('DesktopDirectory', 'CommonDesktopDirectory', 'Programs', 'CommonPrograms')) {
      $base = [Environment]::GetFolderPath($folder)
      foreach ($relative in @('库存管理.lnk', '库存管理\库存管理.lnk')) {
        $link = Join-Path $base $relative
        if (Test-Path -LiteralPath $link) {
          $shortcut = $shell.CreateShortcut($link)
          if ($shortcut.TargetPath -eq $oldApp) {
            $common = $folder.StartsWith('Common')
            if ($common -ne ($InstallScope -eq 'AllUsers')) {
              Remove-Item -LiteralPath $link
            } else {
              $shortcut.TargetPath = $appPath
              $shortcut.WorkingDirectory = $installRoot
              $shortcut.Save()
            }
          }
        }
      }
    }
  }
  Write-Output '程序目录迁移完成，原有库存和备份保持不变。'
}

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
  if ($Phase -eq 'Finalize') {
    FinalizeMigration
    exit 0
  }
  if ($Operation -eq 'Install' -and $installRoot -match '[^\x20-\x7E]') {
    throw '安装路径只能使用英文字母、数字、空格和英文符号，请选择不含中文的目录，例如 C:\Program Files\EasyERP。'
  }
  $copies = @()
  if ($Operation -eq 'Install') { $copies = @(InstalledCopies) }
  $principal = [Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
  if (@($copies | Where-Object { $_.Key.StartsWith('HKLM:') }).Count -and
      -not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw '已有所有用户安装的版本，请以管理员身份运行安装器后升级或切换安装范围。'
  }
  if (-not (Test-Path -LiteralPath $restartApp)) {
    foreach ($copy in $copies) {
      $previous = Join-Path $copy.Root 'easy-erp-desktop.exe'
      if (Test-Path -LiteralPath $previous) { $restartApp = $previous; break }
    }
  }
  $roots = @($installRoot) + @($copies | ForEach-Object { $_.Root }) | Select-Object -Unique
  $appPaths = @($roots | ForEach-Object { Join-Path $_ 'easy-erp-desktop.exe' })
  $serverPaths = @($roots | ForEach-Object { Join-Path $_ 'easy-erp-server.exe' })
  # Match full executable paths, never terminate every process with a shared name.
  $running = @(Get-CimInstance Win32_Process -Filter "Name='easy-erp-server.exe' OR Name='easy-erp-desktop.exe'")
  $owned = @($running | Where-Object { $_.ExecutablePath -in ($appPaths + $serverPaths) })
  $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  foreach ($process in $owned) {
    $owner = Invoke-CimMethod -InputObject $process -MethodName GetOwnerSid
    if ($owner.ReturnValue -ne 0 -or $owner.Sid -ne $sid) {
      throw '其他 Windows 用户正在运行库存管理，请让该用户选择“全部退出”后再安装。不会强制关闭其他用户的库存服务。'
    }
  }
  $servers = @($owned | Where-Object { $_.ExecutablePath -in $serverPaths } |
    ForEach-Object { Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue })
  $apps = @($owned | Where-Object { $_.ExecutablePath -in $appPaths } |
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
    if (-not $process.HasExited) { $process.Kill(); $stoppedApp = $true }
    if (-not $process.WaitForExit(10000)) { throw '桌面程序尚未退出，已停止安装。' }
  }
  # Covers offline databases too; holds the same directory lock, runs no migrations,
  # and produces the same standard ZIP format as the application's backup page.
  & $BackupTool --backup-only --data-dir $data
  if ($LASTEXITCODE -ne 0) { throw '安装前备份失败，尚未替换程序文件。' }
  if ($StateFile) { ConvertTo-Json -InputObject @($copies) | Set-Content -LiteralPath $StateFile -Encoding UTF8 }
  Write-Output '库存已备份，旧程序已关闭，可以安全安装。'
} catch {
  if ($Phase -eq 'Prepare' -and ($stoppedService -or $stoppedApp) -and (Test-Path $restartApp)) {
    Start-Process -FilePath $restartApp
  }
  Write-Output $_.Exception.Message
  exit 1
}
