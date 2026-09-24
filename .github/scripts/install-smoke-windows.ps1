#Requires -Version 7.0
<#
.SYNOPSIS
  설치 스모크 — Windows NSIS (크로스플랫폼 W3 · L-PKG `#w3-install-smoke`).

.DESCRIPTION
  사용자는 Windows 를 직접 테스트할 수 없다 — 이 러너가 사용자 PC 다. 릴리스와 같은
  설정(tauri.conf.json + tauri.windows.conf.json)으로 만든 설치 파일을 실제로
  설치·실행·재설치·제거하고, 판정을 두 종류로 남긴다.

    gate    — 실패하면 잡이 붉어진다. 설치 파일이 약속하는 것(파일·레지스트리·
              바로가기·사이드카·매니페스트)과 앱이 뜨는 것(로그 기동 줄·DB·창·WebView2).
    observe — 기록만 한다. 사실 확인용(업데이트 때 무엇이 죽는가, 실행 중인 사이드카가
              설치를 막는가, 제거 뒤 무엇이 남는가) — 결론은 보고서가 낸다.

  경로의 근거:
    - 설치 폴더: NSIS installMode=currentUser → `$LOCALAPPDATA\${PRODUCTNAME}`
      (tauri-bundler 2.9.x nsis/installer.nsi `StrCpy $INSTDIR "$LOCALAPPDATA\${PRODUCTNAME}"`).
    - 실행 파일 이름: 레지스트리 Uninstall 키의 `MainBinaryName` 을 그대로 읽는다(설치
      파일이 적는 값) — 이름을 추측하지 않는다.
    - 앱 로그: src-tauri/src/lib.rs `setup_logging` —
      `directories::ProjectDirs::from("com", "kimhyunbin", "ocul-pm").data_dir()/logs`,
      파일 `oculpm.log.YYYY-MM-DD`, 기동 줄 `[FLOW] tracing initialised`.
    - 앱 데이터: Tauri `app_data_dir()` = `%APPDATA%\<identifier>`, DB 는 `ocul-pm.db`.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string] $Installer,
    [Parameter(Mandatory)][string] $Version,
    [Parameter(Mandatory)][string] $OutDir
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$Product = 'Ocul-PM'
$Identifier = 'com.kimhyunbin.ocul-pm'
$InstDir = Join-Path $env:LOCALAPPDATA $Product
$UninstKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\$Product"
$SchemeKey = 'HKCU:\Software\Classes\oculpm'
$ManuProductKey = "HKCU:\Software\kimhyunbin\$Product"
$StartLnk = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\$Product.lnk"
$DesktopLnk = Join-Path ([Environment]::GetFolderPath('Desktop')) "$Product.lnk"
$LogDir = Join-Path $env:APPDATA 'kimhyunbin\ocul-pm\data\logs'
$AppDataDir = Join-Path $env:APPDATA $Identifier
$Db = Join-Path $AppDataDir 'ocul-pm.db'
$TempRoot = if ($env:RUNNER_TEMP) { $env:RUNNER_TEMP } else { $env:TEMP }
$ProbeRoot = Join-Path $TempRoot 'ocul-pm-probe'

$Installer = (Resolve-Path -LiteralPath $Installer).Path
New-Item -ItemType Directory -Force -Path $OutDir, $ProbeRoot | Out-Null
$OutDir = (Resolve-Path -LiteralPath $OutDir).Path

# ── 판정 기록 ──────────────────────────────────────────────────────────────
$script:Rows = [System.Collections.Generic.List[object]]::new()

function Add-Row([string] $Kind, [string] $Name, [bool] $Ok, [string] $Detail) {
    $script:Rows.Add([pscustomobject]@{ Kind = $Kind; Name = $Name; Ok = $Ok; Detail = $Detail })
    $mark = if ($Kind -eq 'observe') { 'OBS ' } elseif ($Ok) { 'PASS' } else { 'FAIL' }
    Write-Host "[$mark] $Name :: $Detail"
}

function Format-Detail($Value) {
    return ((@($Value) | ForEach-Object { "$_" }) -join ' ; ').Trim()
}

# 본문이 throw 하면 실패, 값을 돌려주면 그 값이 상세다.
function Test-Gate([string] $Name, [scriptblock] $Body) {
    try { Add-Row 'gate' $Name $true (Format-Detail (& $Body)) }
    catch { Add-Row 'gate' $Name $false $_.Exception.Message }
}

function Test-Observe([string] $Name, [scriptblock] $Body) {
    try { Add-Row 'observe' $Name $true (Format-Detail (& $Body)) }
    catch { Add-Row 'observe' $Name $false ("관찰 실패: " + $_.Exception.Message) }
}

# ── 도우미 ─────────────────────────────────────────────────────────────────
function Stop-Tree([int] $ProcessId) {
    & taskkill.exe /PID $ProcessId /T /F 2>&1 | Out-Null
}

function Test-Running([System.Diagnostics.Process] $Process) {
    if ($null -eq $Process) { return $false }
    $Process.Refresh()
    return -not $Process.HasExited
}

# 설치 파일·제거 프로그램을 돌리고 끝나기를 기다린다. 무음 설치가 숨은 대화상자에
# 막히면 영영 안 끝난다 — 시한을 넘기면 트리째 끝내고 TimedOut 으로 돌려준다.
function Invoke-Setup([string] $Path, [string[]] $Arguments, [int] $TimeoutSec = 300) {
    $p = Start-Process -FilePath $Path -ArgumentList $Arguments -PassThru
    $null = $p.Handle # 이걸 잡아 둬야 끝난 뒤 ExitCode 가 채워진다 (Start-Process 의 알려진 버릇).
    if (-not $p.WaitForExit($TimeoutSec * 1000)) {
        Stop-Tree $p.Id
        return [pscustomobject]@{ TimedOut = $true; ExitCode = $null }
    }
    return [pscustomobject]@{ TimedOut = $false; ExitCode = $p.ExitCode }
}

function Wait-Until([scriptblock] $Condition, [int] $TimeoutSec, [int] $StepMs = 1000) {
    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    while ((Get-Date) -lt $deadline) {
        if (& $Condition) { return $true }
        Start-Sleep -Milliseconds $StepMs
    }
    return [bool](& $Condition)
}

function Get-AppProcesses([string] $ImageName) {
    Get-CimInstance Win32_Process -Filter "Name = '$ImageName'" |
        Select-Object ProcessId, ParentProcessId, ExecutablePath, CommandLine
}

function Find-SdkTool([string] $Name) {
    $root = Join-Path ${env:ProgramFiles(x86)} 'Windows Kits\10\bin'
    $hit = Get-ChildItem -Path $root -Filter $Name -Recurse -ErrorAction SilentlyContinue |
        Where-Object { $_.FullName -match '\\x64\\' } |
        Sort-Object FullName -Descending | Select-Object -First 1
    if (-not $hit) { throw "$Name 을 $root 아래에서 못 찾았다" }
    return $hit.FullName
}

function Find-Dumpbin {
    $vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
    $hit = & $vswhere -latest -products * -find 'VC\Tools\MSVC\**\bin\Hostx64\x64\dumpbin.exe' | Select-Object -First 1
    if (-not $hit) { throw 'dumpbin.exe 를 못 찾았다 (vswhere)' }
    return $hit
}

function Save-Screenshot([string] $Path) {
    Add-Type -AssemblyName System.Windows.Forms, System.Drawing
    $bounds = [System.Windows.Forms.SystemInformation]::VirtualScreen
    $bmp = [System.Drawing.Bitmap]::new($bounds.Width, $bounds.Height)
    $gfx = [System.Drawing.Graphics]::FromImage($bmp)
    try {
        $gfx.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
        $bmp.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
    } finally {
        $gfx.Dispose(); $bmp.Dispose()
    }
    return "$Path ($($bounds.Width)x$($bounds.Height))"
}

function Get-AppLog {
    if (Test-Path -LiteralPath $LogDir) {
        $hit = Get-ChildItem -LiteralPath $LogDir -Filter 'oculpm.log*' -File -ErrorAction SilentlyContinue |
            Sort-Object LastWriteTime -Descending | Select-Object -First 1
        if ($hit) { return $hit }
    }
    return $null
}

# 기본값은 cargo 패키지 이름(tauri-cli 가 mainBinaryName 없을 때 쓰는 것) — 설치 뒤
# 레지스트리의 MainBinaryName 으로 덮는다. 앞 단계가 실패해도 뒤 단계가 null 로
# 죽지 않게 미리 채워 둔다.
$script:MainExe = Join-Path $InstDir 'ocul-pm.exe'
$script:Mcp = Join-Path $InstDir 'oculpm-mcp.exe'
$script:App = $null

# 앞 단계가 예상 밖으로 터져도 요약은 남긴다 — 본문 전체를 한 번 감싼다.
try {

Write-Host "설치 파일: $Installer ($([math]::Round((Get-Item -LiteralPath $Installer).Length / 1MB, 1)) MB)"
Write-Host "기대 버전: $Version · 설치 폴더: $InstDir"

# ── 1. 설치 ────────────────────────────────────────────────────────────────
Test-Observe 'WebView2 런타임 (러너에 이미 있는 것)' {
    $guid = '{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}'
    $keys = @(
        "HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\$guid",
        "HKLM:\SOFTWARE\Microsoft\EdgeUpdate\Clients\$guid",
        "HKCU:\SOFTWARE\Microsoft\EdgeUpdate\Clients\$guid"
    )
    $pv = $keys | ForEach-Object { (Get-ItemProperty -LiteralPath $_ -Name pv -ErrorAction SilentlyContinue).pv } |
        Where-Object { $_ } | Select-Object -First 1
    if (-not $pv) { throw '레지스트리에 WebView2 pv 가 없다 — 설치 파일이 부트스트래퍼를 돌렸을 것' }
    "pv=$pv"
}

Test-Gate 'NSIS 무음 설치 (/S) 종료 코드 0' {
    $r = Invoke-Setup $Installer @('/S')
    if ($r.TimedOut) { throw '5분 안에 끝나지 않았다 (숨은 대화상자?)' }
    if ($r.ExitCode -ne 0) { throw "종료 코드 $($r.ExitCode)" }
    'exit 0'
}

Test-Gate '레지스트리 — Uninstall 키 (HKCU · currentUser)' {
    $k = Get-ItemProperty -LiteralPath $UninstKey
    if ($k.DisplayVersion -ne $Version) { throw "DisplayVersion=$($k.DisplayVersion) (기대 $Version)" }
    if (-not $k.MainBinaryName) { throw 'MainBinaryName 이 비었다' }
    $script:MainExe = Join-Path $InstDir $k.MainBinaryName
    "DisplayVersion=$($k.DisplayVersion) MainBinaryName=$($k.MainBinaryName) InstallLocation=$($k.InstallLocation) UninstallString=$($k.UninstallString)"
}

Test-Gate '설치 폴더 파일 — 메인 exe · oculpm-mcp.exe · uninstall.exe' {
    if (-not $script:MainExe) { throw 'MainBinaryName 을 못 읽어 메인 exe 를 모른다' }
    foreach ($f in @($script:MainExe, $script:Mcp, (Join-Path $InstDir 'uninstall.exe'))) {
        if (-not (Test-Path -LiteralPath $f)) { throw "없다: $f" }
    }
    $list = Get-ChildItem -LiteralPath $InstDir -Recurse -File |
        ForEach-Object { '{0} ({1:N1} MB)' -f $_.FullName.Substring($InstDir.Length + 1), ($_.Length / 1MB) }
    $list -join ', '
}

Test-Gate '딥링크 스킴 oculpm:// 등록 (HKCU\Software\Classes)' {
    $cmd = (Get-ItemProperty -LiteralPath "$SchemeKey\shell\open\command").'(default)'
    $proto = Get-ItemProperty -LiteralPath $SchemeKey -Name 'URL Protocol' -ErrorAction SilentlyContinue
    if ($null -eq $proto) { throw "'URL Protocol' 값이 없다" }
    if ($cmd -notlike "*$($script:MainExe)*") { throw "열기 명령이 설치된 exe 가 아니다: $cmd" }
    "command=$cmd"
}

Test-Gate '시작 메뉴 바로가기' {
    if (-not (Test-Path -LiteralPath $StartLnk)) { throw "없다: $StartLnk" }
    $StartLnk
}

Test-Observe '바탕화면 바로가기 (무음·수동 설치는 만든다)' {
    if (Test-Path -LiteralPath $DesktopLnk) { "있음: $DesktopLnk" } else { "없음: $DesktopLnk" }
}

Test-Gate '사이드카 oculpm-mcp.exe --version' {
    $out = (& $script:Mcp --version 2>&1 | Out-String).Trim()
    if ($LASTEXITCODE -ne 0) { throw "종료 코드 $LASTEXITCODE — $out" }
    if ($out -ne "oculpm-mcp $Version") { throw "응답이 기대와 다르다: '$out' (기대 'oculpm-mcp $Version')" }
    $out
}

# ── 2. 실행 파일 검사 (D11 b — Common Controls v6 매니페스트) ────────────────
Test-Gate '매니페스트 — 메인 exe 에 Common-Controls 6.0 의존 (mt.exe)' {
    $mt = Find-SdkTool 'mt.exe'
    $xml = Join-Path $OutDir 'main-exe.manifest.xml'
    $out = & $mt -nologo "-inputresource:$($script:MainExe);#1" "-out:$xml" 2>&1 | Out-String
    if ($LASTEXITCODE -ne 0) { throw "mt.exe 종료 코드 $LASTEXITCODE — $out" }
    $text = Get-Content -LiteralPath $xml -Raw
    if ($text -notmatch 'Microsoft\.Windows\.Common-Controls' -or $text -notmatch 'version="6\.0\.0\.0"') {
        throw "Common-Controls 6.0 의존이 없다: $text"
    }
    "Microsoft.Windows.Common-Controls 6.0.0.0 (전문: $(Split-Path -Leaf $xml))"
}

Test-Observe '가져오기 — 메인 exe 가 COMCTL32!TaskDialogIndirect 를 정적으로 부른다 (dumpbin /imports)' {
    $dumpbin = Find-Dumpbin
    $imports = & $dumpbin /nologo /imports $script:MainExe 2>&1 | Out-String
    Set-Content -LiteralPath (Join-Path $OutDir 'main-exe.imports.txt') -Value $imports
    $hasComctl = $imports -match '(?im)^\s*COMCTL32\.dll\s*$'
    $hasTask = $imports -match 'TaskDialogIndirect'
    "COMCTL32.dll=$hasComctl TaskDialogIndirect=$hasTask"
}

Test-Observe 'DLL 의존 — VC++ 런타임(VCRUNTIME140.dll) 필요 여부 (dumpbin /dependents)' {
    $dumpbin = Find-Dumpbin
    $rows = foreach ($exe in @($script:MainExe, $script:Mcp)) {
        $deps = & $dumpbin /nologo /dependents $exe 2>&1 | Out-String
        Set-Content -LiteralPath (Join-Path $OutDir ("{0}.dependents.txt" -f (Split-Path -Leaf $exe))) -Value $deps
        $names = [regex]::Matches($deps, '(?im)^\s+(\S+\.dll)\s*$') | ForEach-Object { $_.Groups[1].Value }
        $vc = @($names | Where-Object { $_ -match '^(vcruntime|msvcp)\d+' })
        '{0}: VC 런타임={1} (DLL {2}개: {3})' -f (Split-Path -Leaf $exe), ($(if ($vc.Count) { $vc -join '+' } else { '없음(정적)' })), $names.Count, ($names -join ' ')
    }
    $rows
}

# ── 3. 실행 ────────────────────────────────────────────────────────────────
Test-Gate '앱 실행 — 프로세스 기동' {
    if (-not $script:MainExe) { throw '메인 exe 를 모른다' }
    $script:App = Start-Process -FilePath $script:MainExe -WorkingDirectory $InstDir -PassThru
    $null = $script:App.Handle # 끝났을 때 ExitCode 를 읽으려고
    "pid=$($script:App.Id)"
}

Test-Gate '앱 로그 — 기동 줄 [FLOW] tracing initialised' {
    if ($null -eq $script:App) { throw '앱이 안 떴다' }
    $ok = Wait-Until -TimeoutSec 90 -Condition {
        $log = Get-AppLog
        $null -ne $log -and (Select-String -LiteralPath $log.FullName -SimpleMatch 'tracing initialised' -Quiet)
    }
    if (-not $ok) {
        $any = Get-ChildItem -Path $env:APPDATA, $env:LOCALAPPDATA -Filter 'oculpm.log*' -Recurse -Depth 5 -ErrorAction SilentlyContinue |
            ForEach-Object FullName
        throw "90초 안에 $LogDir 에 기동 줄이 없다. 다른 곳의 oculpm.log*: $($any -join ', ')"
    }
    (Get-AppLog).FullName
}

Test-Gate '앱 데이터 — ocul-pm.db 생성 (setup 이 DB 열기를 지났다)' {
    if (-not (Wait-Until -TimeoutSec 60 -Condition { Test-Path -LiteralPath $Db })) { throw "60초 안에 $Db 가 없다" }
    $Db
}

Test-Gate '창 — 메인 창이 떴다 (MainWindowTitle)' {
    $ok = Wait-Until -TimeoutSec 60 -Condition {
        $p = Get-Process -Id $script:App.Id -ErrorAction SilentlyContinue
        $script:WindowTitle = if ($p) { $p.MainWindowTitle } else { $null }
        -not [string]::IsNullOrEmpty($script:WindowTitle)
    }
    if (-not $ok) { throw '60초 안에 창 제목이 안 잡힌다 (창이 없거나 숨었다)' }
    "MainWindowTitle='$($script:WindowTitle)'"
}

# 앱의 WebView2 는 부모가 앱이거나, 명령줄의 --user-data-dir 가 앱 데이터
# (`%LOCALAPPDATA%\<identifier>\EBWebView`)를 가리킨다 — 러너의 다른 Edge 와 가른다.
Test-Gate 'WebView2 — 앱이 띄운 msedgewebview2.exe' {
    $ok = Wait-Until -TimeoutSec 60 -Condition {
        $script:WebViews = @(Get-AppProcesses 'msedgewebview2.exe' | Where-Object {
                $_.ParentProcessId -eq $script:App.Id -or "$($_.CommandLine)" -like "*$Identifier*"
            })
        $script:WebViews.Count -gt 0
    }
    if (-not $ok) { throw '60초 안에 앱의 msedgewebview2.exe 가 없다' }
    $direct = @($script:WebViews | Where-Object ParentProcessId -eq $script:App.Id).Count
    "앱의 webview2 프로세스 $($script:WebViews.Count)개 (앱 직속 자식 $direct)"
}

Test-Gate '생존 — 기동 20초 뒤에도 살아 있다' {
    Start-Sleep -Seconds 20
    if (-not (Test-Running $script:App)) { throw "죽었다 (종료 코드 $($script:App.ExitCode))" }
    "pid=$($script:App.Id) alive"
}

Test-Observe 'comctl32 — 실행 중인 앱이 올린 comctl32.dll 경로 (v6 는 WinSxS)' {
    $mods = (Get-Process -Id $script:App.Id).Modules | Where-Object ModuleName -eq 'comctl32.dll' | ForEach-Object FileName
    if (-not $mods) { throw 'comctl32.dll 이 아직 올라오지 않았다' }
    $mods -join ', '
}

Test-Observe '스크린샷' { Save-Screenshot (Join-Path $OutDir 'windows-app.png') }

Test-Observe '앱 로그 — ERROR/WARN 줄' {
    $log = Get-AppLog
    if (-not $log) { throw '로그 없음' }
    Copy-Item -LiteralPath $log.FullName -Destination (Join-Path $OutDir 'app-first-run.log')
    $bad = @(Select-String -LiteralPath $log.FullName -Pattern '\b(ERROR|WARN)\b' | ForEach-Object { $_.Line.Trim() })
    "ERROR/WARN $($bad.Count)줄" + $(if ($bad.Count) { ': ' + (($bad | Select-Object -First 8) -join ' | ') } else { '' })
}

Test-Observe '실행 중인 앱 이미지 프로세스 (재설치 직전)' {
    Get-AppProcesses (Split-Path -Leaf $script:MainExe) | ForEach-Object { "pid=$($_.ProcessId) $($_.CommandLine)" }
}

# ── 4. 재설치 프로브 — NSIS 가 무엇을 끝내나 (L-PTY2 에게 넘길 사실) ────────
# 템플릿의 CheckIfAppIsRunning 은 `${MAINBINARYNAME}.exe` 를 nsis_tauri_utils
# FindProcessCurrentUser/KillProcessCurrentUser 로 찾는다 — Toolhelp32 의 szExeFile
# (이미지 **파일 이름**) 을 대소문자 무시로 비교하고 경로는 보지 않는다(원문은 보고서).
# 그 규칙이 실제로 그런지 네 프로세스로 확인한다:
#   A 설치된 exe (GUI)                              → 끝나야 한다
#   B 설치된 exe --pty-host                         → 끝나야 한다 (지금 L-PTY 호스트의 모양)
#   C 설치 폴더 밖 복사본 ocul-pm-ptyhost.exe --pty-host → 살아야 한다 (L-PTY2 의 모양)
#   D 설치 폴더 밖 복사본 OCUL-PM.EXE --pty-host    → 끝나야 한다 (경로 무관 · 대소문자 무시)
$script:Probes = [ordered]@{}

function Start-PtyProbe([string] $Key, [string] $Exe) {
    $dir = Join-Path $ProbeRoot $Key
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
    $sock = Join-Path $dir 'pty.sock'
    $p = Start-Process -FilePath $Exe -ArgumentList @('--pty-host', $sock) -PassThru `
        -RedirectStandardOutput (Join-Path $OutDir "probe-$Key.out.txt") `
        -RedirectStandardError (Join-Path $OutDir "probe-$Key.err.txt")
    $script:Probes[$Key] = $p
}

Test-Gate '재설치 프로브 — 준비 (B·C·D 호스트가 떠 있다)' {
    $c = Join-Path $ProbeRoot 'copies-c'
    $d = Join-Path $ProbeRoot 'copies-d'
    New-Item -ItemType Directory -Force -Path $c, $d | Out-Null
    $copyC = Join-Path $c 'ocul-pm-ptyhost.exe'
    $copyD = Join-Path $d 'OCUL-PM.EXE'
    Copy-Item -LiteralPath $script:MainExe -Destination $copyC -Force
    Copy-Item -LiteralPath $script:MainExe -Destination $copyD -Force
    Start-PtyProbe 'B' $script:MainExe
    Start-PtyProbe 'C' $copyC
    Start-PtyProbe 'D' $copyD
    Start-Sleep -Seconds 4
    $dead = @('B', 'C', 'D' | Where-Object { -not (Test-Running $script:Probes[$_]) })
    if (-not (Test-Running $script:App)) { $dead += 'A' }
    if ($dead.Count) {
        $why = $dead | ForEach-Object {
            $err = Join-Path $OutDir "probe-$_.err.txt"
            "$_ : " + $(if (Test-Path -LiteralPath $err) { (Get-Content -LiteralPath $err -Raw) } else { '' })
        }
        throw "재설치 전에 이미 죽은 프로브: $($dead -join ',') — $($why -join ' | ')"
    }
    'A=' + $script:App.Id + ' B=' + $script:Probes['B'].Id + ' C=' + $script:Probes['C'].Id + ' D=' + $script:Probes['D'].Id
}

Test-Gate '재설치 (/S) — 실행 중인 앱이 있어도 종료 코드 0' {
    $r = Invoke-Setup $Installer @('/S')
    if ($r.TimedOut) { throw '5분 안에 끝나지 않았다' }
    if ($r.ExitCode -ne 0) { throw "종료 코드 $($r.ExitCode)" }
    Start-Sleep -Seconds 2
    'exit 0'
}

Test-Gate '재설치 프로브 — 이미지 이름이 같으면 끝나고(A·B·D), 다르면 산다(C)' {
    $state = [ordered]@{
        A = Test-Running $script:App
        B = Test-Running $script:Probes['B']
        C = Test-Running $script:Probes['C']
        D = Test-Running $script:Probes['D']
    }
    $summary = ($state.GetEnumerator() | ForEach-Object { "$($_.Key)=" + $(if ($_.Value) { '살아 있음' } else { '끝남' }) }) -join ' '
    if ($state.A -or $state.B -or $state.D -or -not $state.C) { throw "기대(A·B·D 끝남, C 살아 있음)와 다르다: $summary" }
    $summary
}

Test-Observe '재설치 뒤 남은 앱 이미지 프로세스' {
    $rows = @(Get-AppProcesses (Split-Path -Leaf $script:MainExe)) + @(Get-AppProcesses 'ocul-pm-ptyhost.exe')
    if (-not $rows.Count) { '없음' } else { $rows | ForEach-Object { "pid=$($_.ProcessId) $($_.ExecutablePath)" } }
}

foreach ($p in $script:Probes.Values) { if (Test-Running $p) { Stop-Tree $p.Id } }

# ── 5. 사이드카 잠금 프로브 — 도는 oculpm-mcp.exe 가 재설치를 막는가 ──────────
# Claude Code·Codex 는 설치 폴더의 oculpm-mcp.exe 를 MCP 서버로 띄워 둔다. 업데이트
# 순간에도 떠 있는 것이 보통이다. 이름이 달라 설치 파일은 이 프로세스를 끝내지 않는다.
$script:McpProc = $null
Test-Observe '사이드카 잠금 — 실행 중인 oculpm-mcp.exe 파일에 쓰기 열기' {
    $psi = [System.Diagnostics.ProcessStartInfo]::new($script:Mcp)
    $psi.UseShellExecute = $false
    $psi.RedirectStandardInput = $true
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.CreateNoWindow = $true
    $psi.WorkingDirectory = $ProbeRoot
    $script:McpProc = [System.Diagnostics.Process]::Start($psi)
    Start-Sleep -Seconds 2
    if (-not (Test-Running $script:McpProc)) { throw "MCP 서버가 바로 끝났다: $($script:McpProc.StandardError.ReadToEnd())" }
    try {
        $fs = [System.IO.File]::Open($script:Mcp, 'Open', 'ReadWrite', 'None')
        $fs.Dispose()
        '쓰기 열기 성공 — 잠기지 않았다'
    } catch {
        "쓰기 열기 실패(잠김): $($_.Exception.Message)"
    }
}

Test-Observe '사이드카 잠금 — 그 상태로 재설치 (/S)' {
    if (-not (Test-Running $script:McpProc)) { throw 'MCP 서버가 안 떠 있다 — 프로브 무효' }
    $before = (Get-Item -LiteralPath $script:Mcp).LastWriteTimeUtc
    $r = Invoke-Setup $Installer @('/S') -TimeoutSec 180
    $alive = Test-Running $script:McpProc
    $after = if (Test-Path -LiteralPath $script:Mcp) { (Get-Item -LiteralPath $script:Mcp).LastWriteTimeUtc } else { $null }
    $exit = if ($r.TimedOut) { '시한 초과(180초 — 숨은 대화상자에 멈춤)' } else { "종료 코드 $($r.ExitCode)" }
    "$exit · MCP 서버 " + $(if ($alive) { '살아 있음' } else { '끝남' }) + " · oculpm-mcp.exe LastWriteTimeUtc $before → $after"
}

if (Test-Running $script:McpProc) {
    try { $script:McpProc.StandardInput.Close() } catch { }
    Start-Sleep -Seconds 1
    if (Test-Running $script:McpProc) { Stop-Tree $script:McpProc.Id }
}

Test-Gate '정상 재설치 (/S) — 잠금 프로브 뒤 상태 복구' {
    $r = Invoke-Setup $Installer @('/S')
    if ($r.TimedOut) { throw '5분 안에 끝나지 않았다' }
    if ($r.ExitCode -ne 0) { throw "종료 코드 $($r.ExitCode)" }
    foreach ($f in @($script:MainExe, $script:Mcp)) { if (-not (Test-Path -LiteralPath $f)) { throw "없다: $f" } }
    $out = (& $script:Mcp --version 2>&1 | Out-String).Trim()
    "exit 0 · $out"
}

# ── 6. 제거 ────────────────────────────────────────────────────────────────
Get-AppProcesses (Split-Path -Leaf $script:MainExe) | ForEach-Object { Stop-Tree $_.ProcessId }

Test-Gate 'NSIS 무음 제거 (uninstall.exe /S)' {
    $u = Join-Path $InstDir 'uninstall.exe'
    $r = Invoke-Setup $u @('/S')
    if ($r.TimedOut) { throw '5분 안에 끝나지 않았다' }
    # NSIS 제거 프로그램은 %TEMP% 로 자기를 복사해 다시 뜨고 원래 프로세스는 바로 끝난다 —
    # 실제 제거가 끝나기를 파일로 기다린다.
    $gone = Wait-Until -TimeoutSec 120 -Condition { -not (Test-Path -LiteralPath $script:MainExe) -and -not (Test-Path -LiteralPath $UninstKey) }
    if (-not $gone) { throw "120초 안에 제거가 끝나지 않았다 (종료 코드 $($r.ExitCode))" }
    "exit $($r.ExitCode)"
}

Test-Gate '제거 잔재 — 실행 파일 · 레지스트리 · 스킴 · 시작 메뉴' {
    $left = @()
    foreach ($f in @($script:MainExe, $script:Mcp, (Join-Path $InstDir 'uninstall.exe'), $StartLnk)) {
        if (Test-Path -LiteralPath $f) { $left += $f }
    }
    foreach ($k in @($UninstKey, $SchemeKey)) { if (Test-Path -LiteralPath $k) { $left += $k } }
    if ($left.Count) { throw "남았다: $($left -join ', ')" }
    '없음'
}

Test-Observe '제거 잔재 — 설치 폴더' {
    if (-not (Test-Path -LiteralPath $InstDir)) { '폴더 없음' }
    else { "폴더 남음: " + ((Get-ChildItem -LiteralPath $InstDir -Recurse -Force | ForEach-Object FullName) -join ', ') }
}

Test-Observe '제거 잔재 — 바탕화면 바로가기 · 제조사 키 · 사용자 데이터 (무음 제거는 앱 데이터 삭제 확인란이 꺼진 채)' {
    $rows = foreach ($p in @($DesktopLnk, $ManuProductKey, $AppDataDir, (Join-Path $env:LOCALAPPDATA $Identifier), (Split-Path -Parent (Split-Path -Parent $LogDir)))) {
        '{0}={1}' -f $p, $(if (Test-Path -LiteralPath $p) { '남음' } else { '없음' })
    }
    $rows
}

Test-Observe '제거 뒤 남은 프로세스' {
    $rows = @(Get-AppProcesses 'ocul-pm.exe') + @(Get-AppProcesses 'oculpm-mcp.exe')
    if (-not $rows.Count) { '없음' } else { $rows | ForEach-Object { "pid=$($_.ProcessId) $($_.ExecutablePath)" } }
}

} catch {
    Add-Row 'gate' '스크립트 자체 오류 (여기서 멈춤)' $false ("$($_.Exception.Message) @ $($_.InvocationInfo.PositionMessage)")
} finally {
    # 남은 프로세스 정리 — 다음 단계(아티팩트 업로드)가 잠긴 파일에 걸리지 않게.
    foreach ($name in @('ocul-pm.exe', 'ocul-pm-ptyhost.exe', 'oculpm-mcp.exe')) {
        Get-AppProcesses $name | ForEach-Object { Stop-Tree $_.ProcessId }
    }
}

# ── 요약 ───────────────────────────────────────────────────────────────────
$gates = @($script:Rows | Where-Object Kind -eq 'gate')
$failed = @($gates | Where-Object { -not $_.Ok })
$md = [System.Text.StringBuilder]::new()
[void]$md.AppendLine("## 설치 스모크 — windows (Ocul-PM $Version)")
[void]$md.AppendLine('')
[void]$md.AppendLine("gate $($gates.Count)건 중 실패 $($failed.Count)건 · 관찰 $(@($script:Rows | Where-Object Kind -eq 'observe').Count)건")
[void]$md.AppendLine('')
[void]$md.AppendLine('| 종류 | 결과 | 항목 | 상세 |')
[void]$md.AppendLine('|---|---|---|---|')
foreach ($r in $script:Rows) {
    $res = if ($r.Kind -eq 'observe') { $(if ($r.Ok) { '기록' } else { '관찰 실패' }) } elseif ($r.Ok) { '통과' } else { '**실패**' }
    $detail = ($r.Detail -replace '\|', '\|' -replace "`r?`n", ' ')
    if ($detail.Length -gt 600) { $detail = $detail.Substring(0, 600) + '…' }
    [void]$md.AppendLine("| $($r.Kind) | $res | $($r.Name) | $detail |")
}
$text = $md.ToString()
Set-Content -LiteralPath (Join-Path $OutDir 'summary.md') -Value $text -Encoding utf8
if ($env:GITHUB_STEP_SUMMARY) { Add-Content -LiteralPath $env:GITHUB_STEP_SUMMARY -Value $text -Encoding utf8 }

if ($failed.Count) {
    Write-Host "::error::설치 스모크(windows) gate 실패 $($failed.Count)건: $(($failed | ForEach-Object Name) -join ' / ')"
    exit 1
}
Write-Host "설치 스모크(windows) 통과 — gate $($gates.Count)건"
exit 0
