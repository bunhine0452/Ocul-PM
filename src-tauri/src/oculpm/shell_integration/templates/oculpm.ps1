# shell_version: 1
# ocul-pm shell integration (PowerShell 5.1 and 7+) -- reports command
# boundaries, exit codes and the working directory to the app.
#
# Generated and managed by ocul-pm. Edits are overwritten on upgrade.
#
# ASCII only, on purpose: Windows PowerShell 5.1 reads a script without a BOM
# in the machine's ANSI code page, so a non-ASCII byte here would decode
# differently from machine to machine.
#
# Design notes (the zsh/bash scripts follow the same rules):
#  - Your profile is never run on your behalf. It carries one inert line that
#    loads this file only inside a terminal ocul-pm launched.
#  - The prompt is left alone. Prompt frameworks (oh-my-posh, starship) are
#    usually set up in Microsoft.PowerShell_profile.ps1, which runs after
#    profile.ps1 and replaces `prompt` outright, so a prompt wrapper would be
#    thrown away. Everything hangs off PSConsoleHostReadLine instead: the host
#    calls it once per input line, after the prompt is drawn, and PSReadLine
#    (which defines it) is loaded before any profile runs.
#  - Every OSC 133 marker carries the nonce the app put in OCULPM_NONCE. The
#    app ignores a marker whose nonce does not match -- with no exceptions,
#    because an exception would be the hole. OSC 7 has no slot for a nonce and
#    is only a display hint.
#  - Markers go out through $Host.UI.Write, not [Console]::Write: the latter
#    encodes with the console code page (437, 949, ...) and turns non-ASCII
#    paths and commands into '?'.
#  - Safe under Set-StrictMode, and cmdlets are module-qualified, so a user's
#    strict mode, aliases or same-named functions do not change what runs.

# Only inside an ocul-pm terminal, only in the console host, only once.
if (-not $env:OCULPM_TERM) { return }
if (Microsoft.PowerShell.Utility\Get-Variable -Name __oculpm_si_loaded -Scope Global -ErrorAction Ignore) { return }
if ($Host.Name -ne 'ConsoleHost') { return }
if ($ExecutionContext.SessionState.LanguageMode -ne 'FullLanguage') { return }
# tmux/screen consume OSC 133 and never pass it on -- off beats half on.
if ($env:TMUX) { return }
if ("$env:TERM" -match '^(screen|tmux)|^(dumb|linux)$') { return }
$global:__oculpm_si_loaded = $true

# Session shim: the profile has built PATH by now; put only the shim dir in
# front of it. Handing the terminal the app's own PATH would drop the user's.
& {
  $dir = $env:OCULPM_SHIM_DIR
  if (-not $dir) { return }
  if (-not (Microsoft.PowerShell.Management\Test-Path -LiteralPath $dir -PathType Container)) { return }
  $sep = [string][System.IO.Path]::PathSeparator
  if (("$env:PATH" -split [regex]::Escape($sep)) -notcontains $dir) {
    $env:PATH = $dir + $sep + $env:PATH
  }
}

# PSReadLine defines the per-line hook. Without it (removed on purpose, or a
# screen reader turned it off) there is nothing to hang on: stay off.
if (-not (Microsoft.PowerShell.Core\Get-Command -Name PSConsoleHostReadLine -CommandType Function -ErrorAction Ignore)) { return }

$global:__oculpm_nonce = [string]$env:OCULPM_NONCE
$global:__oculpm_ran = $false
$global:__oculpm_lec = $null
$global:__oculpm_inner_readline = $function:PSConsoleHostReadLine

# Payload escaping -- the same table the zsh/bash scripts use and the app undoes.
function global:__oculpm_esc([string]$s) {
  $s.Replace('\', '\\').Replace(';', '\x3b').Replace("`n", '\x0a').Replace("`r", '\x0d').Replace([string][char]27, '\x1b').Replace([string][char]7, '\x07')
}

function global:__oculpm_osc([string]$body) {
  $Host.UI.Write([string][char]27 + ']' + $body + [string][char]7)
}

# Before an input line: close the command that just ran (D), then open a
# prompt (A with the working directory, B).
function global:__oculpm_before_input([bool]$ok) {
  Microsoft.PowerShell.Core\Set-StrictMode -Off
  $n = $global:__oculpm_nonce
  if ($global:__oculpm_ran) {
    $global:__oculpm_ran = $false
    $code = 0
    if (-not $ok) {
      $code = 1
      # A native program sets $LASTEXITCODE: report its code when this command changed it.
      $lec = Microsoft.PowerShell.Utility\Get-Variable -Name LASTEXITCODE -Scope Global -ValueOnly -ErrorAction Ignore
      if (($lec -is [int]) -and ($lec -ne 0) -and ($lec -ne $global:__oculpm_lec)) { $code = $lec }
    }
    __oculpm_osc "133;D;$code;nonce=$n"
  }
  $loc = $ExecutionContext.SessionState.Path.CurrentLocation
  if ($loc.Provider.Name -eq 'FileSystem') {
    $p = $loc.ProviderPath
    __oculpm_osc ("133;A;nonce=$n;cwd=" + (__oculpm_esc $p))
    $u = $p.Replace('\', '/')
    if (-not $u.StartsWith('/')) { $u = '/' + $u }
    __oculpm_osc ('7;file://' + [System.Environment]::MachineName + $u)
  } else {
    __oculpm_osc "133;A;nonce=$n"
  }
  __oculpm_osc "133;B;nonce=$n"
}

function global:PSConsoleHostReadLine {
  # First statement on purpose: $? still holds the status of the last command
  # line here -- PSReadLine's own PSConsoleHostReadLine reads it the same way.
  $ok = $?
  Microsoft.PowerShell.Core\Set-StrictMode -Off
  __oculpm_before_input $ok
  # Hand the failure back to PSReadLine, which colours the prompt with it.
  if (-not $ok) { Microsoft.PowerShell.Utility\Write-Error -Message 'oculpm' -ErrorAction Ignore }
  $line = $global:__oculpm_inner_readline.Invoke()
  $text = -join $line
  if ($text.Trim()) {
    $global:__oculpm_lec = Microsoft.PowerShell.Utility\Get-Variable -Name LASTEXITCODE -Scope Global -ValueOnly -ErrorAction Ignore
    $global:__oculpm_ran = $true
    __oculpm_osc ('133;C;nonce=' + $global:__oculpm_nonce + ';cmd=' + (__oculpm_esc $text))
  }
  $line
}
