@echo off
rem ocul-pm - Windows launcher for the oculpm MCP server (.mcp.json).
rem
rem Claude Code starts a stdio MCP server without a shell. On Windows it cannot
rem open the POSIX sh shuttle (bin\oculpm-mcp) as a program: it reads the "#!"
rem line and tries to run "sh", which is not on PATH unless Claude was started
rem from Git Bash. So .mcp.json points at bin/${OS:-posix}/oculpm-mcp instead.
rem Windows always sets OS=Windows_NT, which lands here (the .cmd extension is
rem found through PATHEXT); everywhere else OS is unset and the same line lands
rem on bin/posix/oculpm-mcp.
rem
rem Lookup order is the same as the sh shuttle and the app's settings screen
rem (oculpm/mcp/register.rs locate_binary): OCULPM_MCP_BIN, the per-user NSIS
rem install, its multi-user variant, the system install, then a repo dev build.
rem
rem Keep this file ASCII-only: cmd.exe reads batch files in the OEM code page,
rem and multi-byte text can swallow the next character on CJK code pages.
rem No labels / goto either: they misparse in LF-only batch files.
rem stdout is the MCP protocol - anything for a person goes to stderr.
setlocal EnableExtensions DisableDelayedExpansion
set "OCULPM_EXE="
if defined OCULPM_MCP_BIN if exist "%OCULPM_MCP_BIN%" set "OCULPM_EXE=%OCULPM_MCP_BIN%"
if not defined OCULPM_EXE if defined LOCALAPPDATA if exist "%LOCALAPPDATA%\Ocul-PM\oculpm-mcp.exe" set "OCULPM_EXE=%LOCALAPPDATA%\Ocul-PM\oculpm-mcp.exe"
if not defined OCULPM_EXE if defined LOCALAPPDATA if exist "%LOCALAPPDATA%\Programs\Ocul-PM\oculpm-mcp.exe" set "OCULPM_EXE=%LOCALAPPDATA%\Programs\Ocul-PM\oculpm-mcp.exe"
if not defined OCULPM_EXE if defined ProgramFiles if exist "%ProgramFiles%\Ocul-PM\oculpm-mcp.exe" set "OCULPM_EXE=%ProgramFiles%\Ocul-PM\oculpm-mcp.exe"
if not defined OCULPM_EXE if defined ProgramW6432 if exist "%ProgramW6432%\Ocul-PM\oculpm-mcp.exe" set "OCULPM_EXE=%ProgramW6432%\Ocul-PM\oculpm-mcp.exe"
if not defined OCULPM_EXE if exist "%~dp0..\..\..\..\src-tauri\target\debug\oculpm-mcp.exe" set "OCULPM_EXE=%~dp0..\..\..\..\src-tauri\target\debug\oculpm-mcp.exe"
if not defined OCULPM_EXE if exist "%~dp0..\..\..\..\src-tauri\target\release\oculpm-mcp.exe" set "OCULPM_EXE=%~dp0..\..\..\..\src-tauri\target\release\oculpm-mcp.exe"
if not defined OCULPM_EXE (
  echo oculpm-mcp: executable not found - install the Ocul app ^(https://oculpm.com^) or set OCULPM_MCP_BIN to oculpm-mcp.exe. 1>&2
  exit /b 1
)
"%OCULPM_EXE%" %*
exit /b %ERRORLEVEL%
