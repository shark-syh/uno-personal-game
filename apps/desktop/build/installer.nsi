!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "FileFunc.nsh"
!include "x64.nsh"

!ifndef APP_ID
  !define APP_ID "com.uno.local"
!endif
!ifndef PRODUCT_NAME
  !define PRODUCT_NAME "UNO"
!endif
!ifndef PRODUCT_FILENAME
  !define PRODUCT_FILENAME "UNO"
!endif
!ifndef VERSION
  !define VERSION "1.3.0"
!endif
!ifndef SHORTCUT_NAME
  !define SHORTCUT_NAME "${PRODUCT_NAME}"
!endif
!ifndef UNINSTALL_DISPLAY_NAME
  !define UNINSTALL_DISPLAY_NAME "${PRODUCT_NAME} ${VERSION}"
!endif
!ifdef COMPANY_NAME
  !define PUBLISHER "${COMPANY_NAME}"
!else
  !define PUBLISHER "shark-syh"
!endif

!define APP_EXE "${PRODUCT_FILENAME}.exe"
!define UNINSTALL_EXE "Uninstall ${PRODUCT_FILENAME}.exe"
!define INSTALL_KEY "Software\${APP_ID}"
!define UNINSTALL_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_ID}"

Name "${PRODUCT_NAME}"
BrandingText "${PRODUCT_NAME} ${VERSION}"
InstallDir "$LOCALAPPDATA\Programs\${PRODUCT_FILENAME}"
InstallDirRegKey HKCU "${INSTALL_KEY}" "InstallLocation"
RequestExecutionLevel user
ShowInstDetails nevershow
ShowUninstDetails nevershow

!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "SimpChinese"
!insertmacro MUI_LANGUAGE "English"

Function CheckAppRunning
  nsProcess::_FindProcess "${APP_EXE}"
  Pop $R0
  ${If} $R0 == 0
    ${IfNot} ${Silent}
      MessageBox MB_OK|MB_ICONEXCLAMATION|MB_SETFOREGROUND "请先退出 ${PRODUCT_NAME}，再运行安装程序。"
    ${EndIf}
    Abort
  ${EndIf}
FunctionEnd

Function .onInit
  SetShellVarContext current
  ${IfNot} ${RunningX64}
    MessageBox MB_OK|MB_ICONSTOP "UNO 仅支持 64 位 Windows。"
    Abort
  ${EndIf}
  Call CheckAppRunning
FunctionEnd

Section "Install"
  SetShellVarContext current

  ${If} $INSTDIR != ""
    RMDir /r "$INSTDIR"
  ${EndIf}

  SetOutPath "$INSTDIR"
  InitPluginsDir
  File /oname=$PLUGINSDIR\app.7z "${APP_64}"
  Nsis7z::Extract "$PLUGINSDIR\app.7z"
  WriteUninstaller "$INSTDIR\${UNINSTALL_EXE}"

  CreateDirectory "$SMPROGRAMS\${SHORTCUT_NAME}"
  CreateShortcut "$SMPROGRAMS\${SHORTCUT_NAME}\${SHORTCUT_NAME}.lnk" "$INSTDIR\${APP_EXE}"
  CreateShortcut "$DESKTOP\${SHORTCUT_NAME}.lnk" "$INSTDIR\${APP_EXE}"

  WriteRegStr HKCU "${INSTALL_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayName" "${UNINSTALL_DISPLAY_NAME}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayIcon" "$INSTDIR\${APP_EXE}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "Publisher" "${PUBLISHER}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "UninstallString" '"$INSTDIR\${UNINSTALL_EXE}"'
  WriteRegStr HKCU "${UNINSTALL_KEY}" "QuietUninstallString" '"$INSTDIR\${UNINSTALL_EXE}" /S'
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoRepair" 1

  ${GetSize} "$INSTDIR" "/S=0K" $0 $1 $2
  IntFmt $0 "0x%08X" $0
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "EstimatedSize" "$0"
SectionEnd

Function .onInstSuccess
  !ifdef RUN_AFTER_FINISH
    ${IfNot} ${Silent}
      Exec '"$INSTDIR\${APP_EXE}"'
    ${EndIf}
  !endif
FunctionEnd

Function un.CheckAppRunning
  nsProcess::_FindProcess "${APP_EXE}"
  Pop $R0
  ${If} $R0 == 0
    MessageBox MB_OK|MB_ICONEXCLAMATION|MB_SETFOREGROUND "请先退出 ${PRODUCT_NAME}，再卸载。"
    Abort
  ${EndIf}
FunctionEnd

Function un.onInit
  SetShellVarContext current
  ReadRegStr $0 HKCU "${INSTALL_KEY}" "InstallLocation"
  ${If} $0 != ""
    StrCpy $INSTDIR $0
  ${EndIf}

  ${IfNot} ${Silent}
    MessageBox MB_OKCANCEL|MB_ICONQUESTION "确定要卸载 ${PRODUCT_NAME} 吗？" IDOK +2
    Abort
  ${EndIf}

  Call un.CheckAppRunning
FunctionEnd

Section "Uninstall"
  SetShellVarContext current

  Delete "$DESKTOP\${SHORTCUT_NAME}.lnk"
  Delete "$SMPROGRAMS\${SHORTCUT_NAME}\${SHORTCUT_NAME}.lnk"
  RMDir "$SMPROGRAMS\${SHORTCUT_NAME}"

  DeleteRegKey HKCU "${UNINSTALL_KEY}"
  DeleteRegKey HKCU "${INSTALL_KEY}"

  SetOutPath $TEMP
  ${If} $INSTDIR != ""
    RMDir /r "$INSTDIR"
  ${EndIf}
SectionEnd
