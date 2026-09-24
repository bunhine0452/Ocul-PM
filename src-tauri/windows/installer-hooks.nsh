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
;   2. VC++ runtime  -- install the bundled Microsoft Visual C++ Redistributable only when
;                       it is missing or older than required; stop the install if that fails
;   3. sidecar aside -- move a running oculpm-mcp.exe out of the way so File can replace it
; Every decision is appended to %TEMP%\ocul-pm-setup.log (the install smoke reads it).
;
; Test injection (used by .github/scripts/install-smoke-windows.ps1, harmless otherwise):
;   OCULPM_TEST_OS_BUILD=<n>        pretend the OS build is <n>
;   OCULPM_TEST_VCREDIST_EXIT=<n>   do not run vc_redist; pretend it exited with <n>

; ----------------------------------------------------------------------------------------
; Policy
; ----------------------------------------------------------------------------------------

; ocul-pm.exe statically imports DirectML.dll!DMLCreateDevice1 (the prebuilt ONNX Runtime
; is always built with DirectML on Windows -- ort-sys build/static_link/mod.rs).
; DMLCreateDevice1 exists from DirectML 1.1.0, which ships in-box from Windows 10 version
; 2004, build 19041 (learn.microsoft.com/windows/ai/directml/dml-version-history). On older
; builds the loader fails before main() runs.
!define OCULPM_MIN_OS_BUILD 19041

; Microsoft's rule (STL changelog, VS 2022 17.10 constexpr mutex; binary-compat-2015-2017):
; "the Redistributable version must be at least as new as the latest toolset used by any
; app component". Two toolsets meet in ocul-pm.exe / oculpm-mcp.exe:
;   - the prebuilt ONNX Runtime, the code that calls MSVCP140 (ort-sys 2.0.0-rc.12 -> pyke
;     ms@1.24.2 onnxruntime.lib: all 962 objects carry @comp.id build 35222 = MSVC 14.44;
;     the imports include the mutex machinery _Mtx_init_in_situ / _Mtx_lock / _Cnd_*), and
;   - the build machine's MSVC that links it, together with msvcprt.lib (Rich header of the
;     shipped exe: linker build 36257, i.e. the 14.51 family on windows-latest, 2026-09).
; The latest one decides: the 14.51 family. So the floor is the redistributable we ship,
; 14.51.36247 -- the newest 14.51 one (aka.ms/vc14). fetch-vcredist.ps1 refuses to build
; when the build machine's toolset family is newer than the bundled redistributable, and
; the install smoke refuses an exe whose code was compiled by a newer MSVC than its linker.
; Raise this together with the pin in fetch-vcredist.ps1.
!define OCULPM_VCRT_MIN_BLD 36247

; ----------------------------------------------------------------------------------------
; The redistributable itself -- written by .github/scripts/fetch-vcredist.ps1 (pinned URL,
; SHA-256 and Authenticode checked). Defines OCULPM_VCREDIST_EXE / _VERSION / _BLD.
; ----------------------------------------------------------------------------------------
!include /NONFATAL "${__FILEDIR__}\vcredist\vcredist.nsh"
!ifndef OCULPM_VCREDIST_EXE
  !error "src-tauri/windows/vcredist/vcredist.nsh is missing: run .github/scripts/fetch-vcredist.ps1 before building the Windows installer"
!endif
!if ${OCULPM_VCREDIST_BLD} < ${OCULPM_VCRT_MIN_BLD}
  !error "the bundled vc_redist is older than OCULPM_VCRT_MIN_BLD"
!endif

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

; $R7 <- "ok" when the x64 runtime is present and new enough, otherwise the reason.
; Two sources, both must agree: the registry key Microsoft documents for detection, and the
; DLLs themselves in the real System32 (a 32-bit installer sees SysWOW64 unless file system
; redirection is off). msvcp140.dll's file build is the runtime build.
!macro OCULPM_VCRT_STATE
  Push $R5
  Push $R6
  StrCpy $R7 "ok"
  SetRegView 64
  ReadRegDWORD $R5 HKLM "SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64" "Installed"
  ReadRegDWORD $R6 HKLM "SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64" "Bld"
  ${If} $R5 != 1
    StrCpy $R7 "registry Installed=$R5"
  ${ElseIf} $R6 < ${OCULPM_VCRT_MIN_BLD}
    StrCpy $R7 "registry Bld=$R6 < ${OCULPM_VCRT_MIN_BLD}"
  ${EndIf}
  ${DisableX64FSRedirection}
  ${IfNot} ${FileExists} "$WINDIR\System32\msvcp140.dll"
    StrCpy $R7 "missing msvcp140.dll"
  ${ElseIfNot} ${FileExists} "$WINDIR\System32\msvcp140_1.dll"
    StrCpy $R7 "missing msvcp140_1.dll"
  ${ElseIfNot} ${FileExists} "$WINDIR\System32\vcruntime140.dll"
    StrCpy $R7 "missing vcruntime140.dll"
  ${ElseIfNot} ${FileExists} "$WINDIR\System32\vcruntime140_1.dll"
    StrCpy $R7 "missing vcruntime140_1.dll"
  ${Else}
    GetDLLVersion "$WINDIR\System32\msvcp140.dll" $R5 $R6
    IntOp $R6 $R6 >> 16
    IntOp $R6 $R6 & 0xFFFF
    ${If} $R6 < ${OCULPM_VCRT_MIN_BLD}
      StrCpy $R7 "msvcp140.dll build $R6 < ${OCULPM_VCRT_MIN_BLD}"
    ${EndIf}
  ${EndIf}
  ${EnableX64FSRedirection}
  Pop $R6
  Pop $R5
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
      "Ocul-PM 은 Windows 10 버전 2004(빌드 ${OCULPM_MIN_OS_BUILD}) 이상에서만 실행돼요. 이 PC 는 빌드 $R7 이에요.$\r$\n$\r$\n앱의 로컬 AI 엔진(ONNX Runtime)이 쓰는 DirectML 기능이 그 버전부터 Windows 에 들어 있어서, 더 낮은 버전에서는 앱이 시작되지 않아요. Windows 업데이트로 최신 버전을 설치한 뒤 다시 설치해 주세요." \
      "Ocul-PM requires Windows 10 version 2004 (build ${OCULPM_MIN_OS_BUILD}) or later. This PC is running build $R7.$\r$\n$\r$\nThe app's local AI engine (ONNX Runtime) uses DirectML features that ship with Windows from that version on, so the app cannot start on older builds. Please update Windows and run the installer again."
  ${EndIf}
  Pop $R8
  Pop $R7
!macroend

; ----------------------------------------------------------------------------------------
; 2. VC++ runtime -- only when missing or too old; UAC appears only then (the bootstrapper
;    elevates itself for its per-machine packages).
; ----------------------------------------------------------------------------------------
!macro OCULPM_ENSURE_VCRT
  Push $R7
  Push $R8
  Push $R9
  !insertmacro OCULPM_VCRT_STATE
  ${If} $R7 == "ok"
    !insertmacro OCULPM_LOG "vcredist: present (build >= ${OCULPM_VCRT_MIN_BLD}), skipping"
  ${Else}
    !insertmacro OCULPM_LOG "vcredist: needed ($R7); bundled ${OCULPM_VCREDIST_VERSION}"
    !insertmacro OCULPM_PICK \
      "Microsoft Visual C++ 재배포 패키지 ${OCULPM_VCREDIST_VERSION} 를 설치하는 중이에요. 관리자 권한 확인(UAC) 창이 뜨면 '예'를 눌러 주세요." \
      "Installing Microsoft Visual C++ Redistributable ${OCULPM_VCREDIST_VERSION}. If Windows asks for administrator permission (UAC), choose Yes."
    DetailPrint "$OculpmMsg"
    InitPluginsDir
    File "/oname=$PLUGINSDIR\vc_redist.x64.exe" "${OCULPM_VCREDIST_EXE}"
    ReadEnvStr $R8 OCULPM_TEST_VCREDIST_EXIT
    ${If} $R8 != ""
      !insertmacro OCULPM_LOG "vcredist: OCULPM_TEST_VCREDIST_EXIT=$R8, not running the bootstrapper"
    ${Else}
      ClearErrors
      ExecWait '"$PLUGINSDIR\vc_redist.x64.exe" /install /quiet /norestart' $R8
      ${If} ${Errors}
        StrCpy $R8 "launch-failed"
      ${EndIf}
      !insertmacro OCULPM_LOG "vcredist: /install exit $R8"
      ; Same (or newer) bundle already registered but files gone or broken: /install is a
      ; no-op (0 / 1638), /repair puts the files back.
      !insertmacro OCULPM_VCRT_STATE
      ${If} $R7 != "ok"
      ${AndIf} $R8 != "1602"
      ${AndIf} $R8 != "launch-failed"
        ClearErrors
        ExecWait '"$PLUGINSDIR\vc_redist.x64.exe" /repair /quiet /norestart' $R9
        ${If} ${Errors}
          StrCpy $R9 "launch-failed"
        ${EndIf}
        !insertmacro OCULPM_LOG "vcredist: still $R7 -> /repair exit $R9"
      ${EndIf}
    ${EndIf}
    !insertmacro OCULPM_VCRT_STATE
    ${If} $R7 == "ok"
      !insertmacro OCULPM_LOG "vcredist: ok after install (exit $R8)"
    ${ElseIf} $R8 == "3010"
      ; Installed, but Windows applies it on restart. Finish the install and say so -- the
      ; app starts after the restart.
      !insertmacro OCULPM_LOG "vcredist: exit 3010, restart required ($R7)"
      SetRebootFlag true
      !insertmacro OCULPM_PICK \
        "Microsoft Visual C++ 재배포 패키지를 설치했지만 Windows 를 다시 시작해야 적용돼요. 다시 시작한 뒤 Ocul-PM 을 실행해 주세요." \
        "The Microsoft Visual C++ Redistributable was installed, but Windows has to restart to finish it. Please restart Windows before starting Ocul-PM."
      MessageBox MB_ICONINFORMATION|MB_OK|MB_TOPMOST|MB_SETFOREGROUND "$OculpmMsg" /SD IDOK
    ${ElseIf} $R8 == "1602"
      !insertmacro OCULPM_STOP \
        "Ocul-PM 에 필요한 Microsoft Visual C++ 재배포 패키지(x64, 빌드 ${OCULPM_VCRT_MIN_BLD} 이상)를 설치하지 못했어요 — 관리자 권한 확인(UAC)이 취소됐어요.$\r$\n이 구성 요소가 없으면 앱이 시작되지 않으므로 설치를 멈춥니다.$\r$\n$\r$\n설치를 다시 실행해 UAC 창에서 '예'를 누르거나, https://aka.ms/vc14/vc_redist.x64.exe 에서 직접 설치한 뒤 다시 시도해 주세요." \
        "Ocul-PM needs the Microsoft Visual C++ Redistributable (x64, build ${OCULPM_VCRT_MIN_BLD} or later), but it could not be installed: the administrator permission prompt (UAC) was cancelled.$\r$\nThe app cannot start without it, so the installation has stopped.$\r$\n$\r$\nRun the installer again and choose Yes in the UAC prompt, or install it from https://aka.ms/vc14/vc_redist.x64.exe and try again."
    ${Else}
      !insertmacro OCULPM_STOP \
        "Ocul-PM 에 필요한 Microsoft Visual C++ 재배포 패키지(x64, 빌드 ${OCULPM_VCRT_MIN_BLD} 이상)를 설치하지 못했어요 (코드 $R8, 상태: $R7).$\r$\n이 구성 요소가 없으면 앱이 시작되지 않으므로 설치를 멈춥니다.$\r$\n$\r$\nhttps://aka.ms/vc14/vc_redist.x64.exe 에서 직접 설치(또는 '복구')한 뒤 Ocul-PM 설치를 다시 실행해 주세요. 자세한 기록: %TEMP%\ocul-pm-setup.log" \
        "Ocul-PM needs the Microsoft Visual C++ Redistributable (x64, build ${OCULPM_VCRT_MIN_BLD} or later), but it could not be installed (code $R8, state: $R7).$\r$\nThe app cannot start without it, so the installation has stopped.$\r$\n$\r$\nInstall (or repair) it from https://aka.ms/vc14/vc_redist.x64.exe, then run the Ocul-PM installer again. Details: %TEMP%\ocul-pm-setup.log"
    ${EndIf}
  ${EndIf}
  Pop $R9
  Pop $R8
  Pop $R7
!macroend

; ----------------------------------------------------------------------------------------
; 3. Running sidecar
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
  !insertmacro OCULPM_ENSURE_VCRT
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
