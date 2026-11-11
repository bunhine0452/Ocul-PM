; Ocul-PM NSIS installer hooks (cross-platform round, lane L-PKG).
; tauri-bundler's installer.nsi includes this file through
; bundle.windows.nsis.installerHooks (src-tauri/tauri.windows.conf.json).
;
; ENCODING: this file is UTF-8 **with BOM**. The Unicode NSIS compiler reads an include
; without a BOM in the build machine's ANSI code page, which would garble the Korean
; messages below. Keep the BOM when editing.
;
; PREINSTALL runs, in order:
;   1. OS floor      -- refuse Windows older than 10 version 2004 (build 19041)
;   2. sidecar aside -- move a running oculpm-mcp.exe out of the way so File can replace it
; There is no VC++ runtime step any more (2026-11-11). Neither executable imports VCRUNTIME140
; or MSVCP140: tauri-build links the VC runtime statically (static_vcruntime -- libcmt +
; libvcruntime, Universal CRT from Windows itself, in-box since Windows 10), and the only
; MSVCP140 caller was the prebuilt ONNX Runtime, which left with 4.0. The install smoke gates
; on it (install-smoke-windows-os.ps1, Test-NoVcRuntimeImports).
; Every decision is appended to %TEMP%\ocul-pm-setup.log (the install smoke reads it).
;
; Test injection (used by .github/scripts/install-smoke-windows.ps1, harmless otherwise):
;   OCULPM_TEST_OS_BUILD=<n>        pretend the OS build is <n>

; ----------------------------------------------------------------------------------------
; Policy
; ----------------------------------------------------------------------------------------

; The floor was set for DirectML (ONNX Runtime imported DirectML.dll!DMLCreateDevice1, in-box
; from Windows 10 version 2004, build 19041). ONNX Runtime left with 4.0, so that reason is gone;
; the floor stays as the oldest build the app has been tested on (every Windows 10 build below it
; is out of support). Lowering it is a separate decision -- the terminal needs ConPTY (1809, 17763).
!define OCULPM_MIN_OS_BUILD 19041

; ----------------------------------------------------------------------------------------
; Helpers
; ----------------------------------------------------------------------------------------
Var OculpmLogFile
Var OculpmMsg

; Append one line (ASCII) to %TEMP%\ocul-pm-setup.log.
!macro OCULPM_LOG TEXT
  FileOpen $OculpmLogFile "$TEMP\ocul-pm-setup.log" a
  FileSeek $OculpmLogFile 0 END
  FileWrite $OculpmLogFile "[ocul-pm ${VERSION}] ${TEXT}$\r$\n"
  FileClose $OculpmLogFile
!macroend

; Pick the Korean or English text by the installer language (Korean = LANGID 1042).
!macro OCULPM_PICK KO EN
  ${If} $LANGUAGE == 1042
    StrCpy $OculpmMsg "${KO}"
  ${Else}
    StrCpy $OculpmMsg "${EN}"
  ${EndIf}
!macroend

; Tell the user why, then stop before any file is copied. Silent installs get the English
; text on the parent console (the same trick the template's CheckIfAppIsRunning uses) and
; in the log; the message box is skipped (/SD). Abort -> exit code 2.
!macro OCULPM_STOP KO EN
  !insertmacro OCULPM_LOG "STOP: ${EN}"
  ${If} ${Silent}
    System::Call 'kernel32::AttachConsole(i -1)i.r0'
    ${If} $0 != 0
      System::Call 'kernel32::GetStdHandle(i -11)i.r0'
      FileWrite $0 "${EN}$\r$\n"
    ${EndIf}
  ${EndIf}
  !insertmacro OCULPM_PICK "${KO}" "${EN}"
  MessageBox MB_ICONSTOP|MB_OK|MB_TOPMOST|MB_SETFOREGROUND "$OculpmMsg" /SD IDOK
  RMDir "$INSTDIR"
  Abort
!macroend

; ----------------------------------------------------------------------------------------
; 1. OS floor
; ----------------------------------------------------------------------------------------
!macro OCULPM_CHECK_OS
  Push $R7
  Push $R8
  ReadEnvStr $R7 OCULPM_TEST_OS_BUILD
  ${If} $R7 == ""
    ReadRegStr $R7 HKLM "SOFTWARE\Microsoft\Windows NT\CurrentVersion" "CurrentBuildNumber"
    StrCpy $R8 "registry"
  ${Else}
    StrCpy $R8 "OCULPM_TEST_OS_BUILD"
  ${EndIf}
  !insertmacro OCULPM_LOG "os: build $R7 (from $R8), need ${OCULPM_MIN_OS_BUILD}"
  ${If} $R7 == ""
    ; Cannot tell -- do not block on a guess; the log says so.
    !insertmacro OCULPM_LOG "os: build unknown, not blocking"
  ${ElseIf} $R7 < ${OCULPM_MIN_OS_BUILD}
    !insertmacro OCULPM_STOP \
      "Ocul-PM 은 Windows 10 버전 2004(빌드 ${OCULPM_MIN_OS_BUILD}) 이상에서만 실행돼요. 이 PC 는 빌드 $R7 이에요.$\r$\n$\r$\n더 낮은 버전에서는 확인된 적이 없어요. Windows 업데이트로 최신 버전을 설치한 뒤 다시 설치해 주세요." \
      "Ocul-PM requires Windows 10 version 2004 (build ${OCULPM_MIN_OS_BUILD}) or later. This PC is running build $R7.$\r$\n$\r$\nOlder builds have not been tested. Please update Windows and run the installer again."
  ${EndIf}
  Pop $R8
  Pop $R7
!macroend

; ----------------------------------------------------------------------------------------
; 2. Running sidecar
; ----------------------------------------------------------------------------------------
; oculpm-mcp.exe is the MCP server that Claude Code / Codex start from $INSTDIR and keep
; running for the whole session. The template's CheckIfAppIsRunning only looks for the
; main binary (ocul-pm.exe) by image name, so a running oculpm-mcp.exe is left alone and
; its file stays locked. The install smoke saw, before this hook:
;   /S          -> File silently skipped it; the old sidecar stayed (exit code 0)
;   /P /UPDATE  -> "Error opening file for writing ... oculpm-mcp.exe" (Abort/Retry/Ignore),
;                  i.e. the in-app update stopped on a dialog after the app had exited.
; A running executable can still be renamed: move it aside and let File write the new one.
; The running server keeps its renamed image; the next install/uninstall deletes leftovers.
!macro OCULPM_SIDECAR_ASIDE
  Delete "$INSTDIR\oculpm-mcp.exe.old-*"
  IfFileExists "$INSTDIR\oculpm-mcp.exe" 0 oculpm_mcp_aside_done
    Push $9
    System::Call 'kernel32::GetTickCount()i .r9'
    Rename "$INSTDIR\oculpm-mcp.exe" "$INSTDIR\oculpm-mcp.exe.old-$9"
    Pop $9
  oculpm_mcp_aside_done:
!macroend

; ----------------------------------------------------------------------------------------
; Hooks
; ----------------------------------------------------------------------------------------
!macro NSIS_HOOK_PREINSTALL
  !insertmacro OCULPM_LOG "preinstall: $CMDLINE"
  !insertmacro OCULPM_CHECK_OS
  !insertmacro OCULPM_SIDECAR_ASIDE
!macroend

!macro NSIS_HOOK_POSTINSTALL
  Delete "$INSTDIR\oculpm-mcp.exe.old-*"
  !insertmacro OCULPM_LOG "postinstall: done"
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  Delete "$INSTDIR\oculpm-mcp.exe.old-*"
  RMDir "$INSTDIR"
!macroend
