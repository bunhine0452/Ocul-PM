@echo off
rem ocul-pm - Windows hook shuttle for Codex (hooks.json "commandWindows").
rem
rem Codex runs hook commands through cmd.exe on Windows, so the sh hooks in this
rem folder cannot run as-is. This file finds Git Bash and runs the named sh hook
rem with it; stdin (the hook payload) and the exit code pass straight through.
rem
rem Git Bash lookup order: %OCULPM_GIT_BASH%, %ProgramFiles%\Git,
rem %ProgramW6432%\Git, %LOCALAPPDATA%\Programs\Git, then the Git found on PATH.
rem bin\bash.exe (not usr\bin\bash.exe) is the entry that puts the Unix tools
rem (find, sort, sed, awk) ahead of C:\Windows\System32 on PATH.
rem
rem Keep this file ASCII-only: cmd.exe reads batch files in the OEM code page,
rem and multi-byte text can swallow the next character on CJK code pages.
rem No labels / goto either: they misparse in LF-only batch files.
setlocal EnableExtensions DisableDelayedExpansion
set "OCULPM_SH="
if defined OCULPM_GIT_BASH if exist "%OCULPM_GIT_BASH%" set "OCULPM_SH=%OCULPM_GIT_BASH%"
if not defined OCULPM_SH if exist "%ProgramFiles%\Git\bin\bash.exe" set "OCULPM_SH=%ProgramFiles%\Git\bin\bash.exe"
if not defined OCULPM_SH if exist "%ProgramW6432%\Git\bin\bash.exe" set "OCULPM_SH=%ProgramW6432%\Git\bin\bash.exe"
if not defined OCULPM_SH if exist "%LOCALAPPDATA%\Programs\Git\bin\bash.exe" set "OCULPM_SH=%LOCALAPPDATA%\Programs\Git\bin\bash.exe"
if not defined OCULPM_SH for /f "delims=" %%G in ('where git.exe 2^>nul') do if not defined OCULPM_SH if exist "%%~dpG..\bin\bash.exe" set "OCULPM_SH=%%~dpG..\bin\bash.exe"
if not defined OCULPM_SH (
  more >nul 2>nul
  echo oculpm: Git Bash not found - ocul-pm hooks are skipped. Install Git for Windows or set OCULPM_GIT_BASH to bash.exe. 1>&2
  exit /b 0
)
"%OCULPM_SH%" "%~dp0%~1"
exit /b %ERRORLEVEL%
