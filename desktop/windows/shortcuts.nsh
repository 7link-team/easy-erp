; Create target and AppUserModelID on the same ShellLink, then save once.
; Do not load/re-save a just-created shortcut through a second COM object:
; a failed Load followed by Save can replace a valid link with an empty one.
; AppUserModelID property handling follows Tauri's MIT-licensed utils.nsh.
!macro ERP_CREATE_SHORTCUT SHORTCUT
  !insertmacro ComHlpr_CreateInProcInstance ${CLSID_ShellLink} ${IID_IShellLink} r0 ""
  ${If} $0 P= 0
    SetErrorLevel 1
    Abort "无法创建程序快捷方式。"
  ${EndIf}
  ${IShellLink::SetPath} $0 '(w "$INSTDIR\${MAINBINARYNAME}.exe")'
  ${IShellLink::SetWorkingDirectory} $0 '(w "$INSTDIR")'
  ${IShellLink::SetDescription} $0 '(w "${PRODUCTNAME}")'
  ${IUnknown::QueryInterface} $0 '("${IID_IPropertyStore}",.r1)'
  ${If} $1 P<> 0
    System::Call 'Oleaut32::SysAllocString(w "${BUNDLEID}") p.r2'
    System::Call '*${SYSSTRUCT_PROPERTYKEY}(${PKEY_AppUserModel_ID})p.r3'
    System::Call '*${SYSSTRUCT_PROPVARIANT}(${VT_BSTR},,&p $2)p.r4'
    ${IPropertyStore::SetValue} $1 '($3,$4)'
    ${IPropertyStore::Commit} $1 ""
    ${IUnknown::Release} $1 ""
    System::Call 'Oleaut32::SysFreeString(p $2)'
    System::Free $3
    System::Free $4
  ${EndIf}
  StrCpy $6 -1
  ${IUnknown::QueryInterface} $0 '("${IID_IPersistFile}",.r1)'
  ${If} $1 P<> 0
    ${IPersistFile::Save} $1 '(w "${SHORTCUT}",1).r6'
    ${IUnknown::Release} $1 ""
  ${EndIf}
  ${IUnknown::Release} $0 ""
  ${If} $6 != 0
    SetErrorLevel 1
    Abort "无法保存程序快捷方式，请检查目录权限。"
  ${EndIf}
!macroend
