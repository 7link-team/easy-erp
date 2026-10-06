$ErrorActionPreference = 'Stop'
$target = 'x86_64-pc-windows-msvc'
$directory = "desktop/target/$target/release"

# Rust's unit-test executable does not inherit Tauri's Windows resources.
# Reuse the packaged app's manifest so both load Common Controls v6.
$messages = & cargo test --locked --release --target $target --manifest-path desktop/Cargo.toml --lib --no-run --message-format=json
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
$executables = @($messages | ForEach-Object {
  $message = $_ | ConvertFrom-Json
  if ($message.reason -eq 'compiler-artifact' -and $message.profile.test -and $message.executable) {
    $message.executable
  }
})
if ($executables.Count -ne 1) { throw "Expected one native test executable, found $($executables.Count)." }
$mt = Get-ChildItem "${env:ProgramFiles(x86)}/Windows Kits/10/bin/*/x64/mt.exe" |
  Sort-Object FullName -Descending | Select-Object -First 1
if (-not $mt) { throw 'Windows SDK manifest tool not found.' }
$manifest = Join-Path $env:RUNNER_TEMP 'easy-erp-native-tests.manifest'
& $mt.FullName -nologo "-inputresource:$directory/easy-erp-desktop.exe;#1" "-out:$manifest"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
foreach ($executable in $executables) {
  & $mt.FullName -nologo "-manifest" $manifest "-outputresource:$executable;#1"
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  & $executable
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}
