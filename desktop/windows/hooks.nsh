!define ERP_WINDOWS_DIR "${__FILEDIR__}"
!include "${ERP_WINDOWS_DIR}\shortcuts.nsh"

!macro ERP_PREPARE_INSTALL OPERATION
  InitPluginsDir
  File /oname=$PLUGINSDIR\erp-prepare.ps1 "${ERP_WINDOWS_DIR}\prepare-install.ps1"
  File /oname=$PLUGINSDIR\erp-backup.exe "${ERP_WINDOWS_DIR}\..\binaries\easy-erp-server-x86_64-pc-windows-msvc.exe"
  DetailPrint "正在备份库存并关闭旧程序，请稍候……"
  ; Match the 64-bit registry view used by SetContext in the installer.
  ${If} ${RunningX64}
    ${DisableX64FSRedirection}
  ${EndIf}
  nsExec::ExecToStack /TIMEOUT=180000 '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\erp-prepare.ps1" -InstallDir "$INSTDIR" -BackupTool "$PLUGINSDIR\erp-backup.exe" -Operation ${OPERATION} -StateFile "$PLUGINSDIR\erp-migration.json"'
  Pop $0
  Pop $1
  ${If} ${RunningX64}
    ${EnableX64FSRedirection}
  ${EndIf}
  ${If} $0 != 0
    DetailPrint "$1"
    IfSilent +2 0
    MessageBox MB_OK|MB_ICONSTOP "无法安全关闭旧程序或完成备份，已停止安装。库存数据未删除。$\r$\n$1"
    SetErrorLevel 1
    Abort
  ${EndIf}
!macroend

!macro NSIS_HOOK_PREINSTALL
  !insertmacro ERP_PREPARE_INSTALL Install
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  !insertmacro ERP_PREPARE_INSTALL Uninstall
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ${If} ${RunningX64}
    ${DisableX64FSRedirection}
  ${EndIf}
  nsExec::ExecToStack /TIMEOUT=30000 '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\erp-prepare.ps1" -InstallDir "$INSTDIR" -BackupTool "$PLUGINSDIR\erp-backup.exe" -Phase Finalize -InstallScope "$MultiUser.InstallMode" -StateFile "$PLUGINSDIR\erp-migration.json"'
  Pop $0
  Pop $1
  ${If} ${RunningX64}
    ${EnableX64FSRedirection}
  ${EndIf}
  DetailPrint "$1"
  ${If} $0 != 0
    IfSilent +2 0
    MessageBox MB_OK|MB_ICONEXCLAMATION "新版已安装，旧程序目录清理未完成。库存数据不受影响。$\r$\n$1"
  ${EndIf}
!macroend
