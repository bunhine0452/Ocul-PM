; Ocul-PM NSIS installer hooks (cross-platform round W3, lane L-PKG).
; tauri-bundler's installer.nsi includes this file through
; bundle.windows.nsis.installerHooks (src-tauri/tauri.windows.conf.json).
; Keep this file ASCII: NSIS reads an include without a BOM in the ANSI code page.
;
; Why: oculpm-mcp.exe is the MCP server that Claude Code / Codex start from $INSTDIR and
; keep running for the whole session. The template's CheckIfAppIsRunning only looks for the
; main binary (ocul-pm.exe) by image name, so a running oculpm-mcp.exe is left alone and its
; file stays locked. The install smoke (.github/workflows/portability.yml) saw:
;   /S                 -> File silently skipped it; the old sidecar stayed (exit code 0)
;   /P /UPDATE         -> "Error opening file for writing ... oculpm-mcp.exe" with
;                         Abort/Retry/Ignore, i.e. the in-app update (tauri-plugin-updater
;                         runs the installer in passive mode after the app has exited)
;                         stops on a dialog.
; A running executable can still be renamed. Move it aside, let File write the new one;
; the running server keeps its renamed image, and whichever install/uninstall comes next
; deletes the leftovers once nothing holds them.

!macro NSIS_HOOK_PREINSTALL
  Delete "$INSTDIR\oculpm-mcp.exe.old-*"
  IfFileExists "$INSTDIR\oculpm-mcp.exe" 0 oculpm_mcp_aside_done
    Push $9
    System::Call 'kernel32::GetTickCount()i .r9'
    Rename "$INSTDIR\oculpm-mcp.exe" "$INSTDIR\oculpm-mcp.exe.old-$9"
    Pop $9
  oculpm_mcp_aside_done:
!macroend

!macro NSIS_HOOK_POSTINSTALL
  Delete "$INSTDIR\oculpm-mcp.exe.old-*"
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  Delete "$INSTDIR\oculpm-mcp.exe.old-*"
  RMDir "$INSTDIR"
!macroend
