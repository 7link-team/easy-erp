!define ERP_WINDOWS_DIR "${__FILEDIR__}"

!macro ERP_PREPARE_INSTALL
  InitPluginsDir
  File /oname=$PLUGINSDIR\erp-prepare.ps1 "${ERP_WINDOWS_DIR}\prepare-install.ps1"
  File /oname=$PLUGINSDIR\erp-backup.exe "${ERP_WINDOWS_DIR}\..\binaries\easy-erp-server-x86_64-pc-windows-msvc.exe"
  DetailPrint "正在备份库存并关闭旧程序，请稍候……"
  nsExec::ExecToStack /TIMEOUT=180000 '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\erp-prepare.ps1" -InstallDir "$INSTDIR" -BackupTool "$PLUGINSDIR\erp-backup.exe"'
  Pop $0
  Pop $1
  ${If} $0 != 0
    DetailPrint "$1"
    IfSilent +2 0
    MessageBox MB_OK|MB_ICONSTOP "无法安全关闭旧程序或完成备份，已停止安装。库存数据未删除。$\r$\n$1"
    Abort
  ${EndIf}
!macroend

!macro NSIS_HOOK_PREINSTALL
  !insertmacro ERP_PREPARE_INSTALL
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  !insertmacro ERP_PREPARE_INSTALL
!macroend
