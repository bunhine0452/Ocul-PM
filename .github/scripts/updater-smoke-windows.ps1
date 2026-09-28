#Requires -Version 7.0
<#
.SYNOPSIS
  업데이터 스모크 — Windows NSIS N→N+1 (크로스플랫폼 L-UPD `#w3-updater-smoke`).

.DESCRIPTION
  사용자는 Windows 를 직접 테스트할 수 없다 — 첫 공개 판의 업데이터가 깨져 있으면 사용자는
  그 판에 갇힌다. 그래서 앱 안 업데이터의 한 바퀴를 이 러너에서 실제로 돌린다.

    N   = 스모크 판. portability.yml bundle 잡이 `--config` 로 업데이터 엔드포인트를
          http://127.0.0.1:<port>/latest.json, 공개 키를 그 잡의 일회용 키로 돌려 굽고(판은
          N+1 보다 낮게), 프런트는 VITE_OCULPM_UPDATER_SMOKE=1 — 새 판을 찾으면 배너의
          「지금 업데이트」 와 같은 install() 을 스스로 부른다(components/UpdateBanner.tsx).
    N+1 = 릴리스와 같은 설정으로 구운 setup.exe(같은 일회용 키로 서명한 .sig). 로컬 서버
          (updater-smoke-http.mjs)가 latest.json(windows-x86_64 · windows-x86_64-nsis —
          릴리스와 같은 키)과 함께 내준다.

  순서가 뜻을 갖는다 — 거절부터:
    1. 서명이 다른 파일의 것(키는 맞고 내용이 다름) → 받은 뒤 검증에서 거절, 설치 파일은 안 돈다
    2. 서명이 다른 키의 것(일회용 키 둘째)          → 거절
    3. 맞는 서명 → 업데이터가 setup.exe /P /R /UPDATE 를 띄우고 앱은 끝난다 → NSIS 가 깔고
       (레지스트리 DisplayVersion · exe 판 · 설치 로그의 `[ocul-pm N+1]` 줄) /R 로 새 판을
       다시 띄운다(기동 줄이 새 판을 말한다)

  판정 두 종류(install-smoke-windows.ps1 과 같다): gate 는 실패하면 잡이 붉고, observe 는
  기록만. 증거: 앱 로그(단계마다 logs-<단계>\ 로 떼어 둔다) · 접근 로그 · 설치 로그 · 스크린샷.

  경로의 근거는 install-smoke-windows.ps1 머리 주석과 같다(설치 폴더 %LOCALAPPDATA%\Ocul-PM,
  앱 로그 %APPDATA%\<identifier>\logs, 설치 훅 로그 %TEMP%\ocul-pm-setup.log). 기동 줄
  `[FLOW] install kind — version X` 는 src-tauri/src/commands/install_kind.rs, 업데이터 줄
  `check -> …` · `install -> …` 는 src/lib/updater.ts 가 남긴다.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string] $BundleDir,
    [Parameter(Mandatory)][string] $UpdaterDir,
    [Parameter(Mandatory)][string] $OutDir
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$Product = 'Ocul-PM'
$Identifier = 'com.kimhyunbin.ocul-pm'
$InstDir = Join-Path $env:LOCALAPPDATA $Product
$UninstKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\$Product"
$LogDir = Join-Path (Join-Path $env:APPDATA $Identifier) 'logs'
$SetupLog = Join-Path $env:TEMP 'ocul-pm-setup.log'
$Http = Join-Path $PSScriptRoot 'updater-smoke-http.mjs'
$Keys = 'windows-x86_64,windows-x86_64-nsis'
$TempRoot = if ($env:RUNNER_TEMP) { $env:RUNNER_TEMP } else { $env:TEMP }
$Serve = Join-Path $TempRoot 'ocul-pm-updater-serve'

New-Item -ItemType Directory -Force -Path $OutDir, $Serve | Out-Null
$OutDir = (Resolve-Path -LiteralPath $OutDir).Path
$BundleDir = (Resolve-Path -LiteralPath $BundleDir).Path
$UpdaterDir = (Resolve-Path -LiteralPath $UpdaterDir).Path
$Access = Join-Path $OutDir 'access.log'

$Info = @{}
$infoFile = Join-Path $UpdaterDir 'updater-info.txt'
if (Test-Path -LiteralPath $infoFile) {
    foreach ($line in Get-Content -LiteralPath $infoFile) {
        if ($line -match '^([a-z_]+)=(.*)$') { $Info[$Matches[1]] = $Matches[2].Trim() }
    }
}
$Base = $Info['base_version']
$New = $Info['payload_version']
$Port = $Info['port']
$BaseSetup = Join-Path $UpdaterDir "base\Ocul-PM_${Base}_x64-setup.exe"
$BaseSig = "$BaseSetup.sig"
$Payload = Join-Path $BundleDir "Ocul-PM_${New}_x64-setup.exe"
$PayloadName = Split-Path -Leaf $Payload
$PayloadSig = Join-Path $UpdaterDir 'payload.sig'
$ForeignSig = Join-Path $UpdaterDir 'foreign.sig'
$Url = "http://127.0.0.1:$Port/$PayloadName"

# ── 판정 기록 (install-smoke-windows.ps1 과 같은 모양) ─────────────────────
$script:Rows = [System.Collections.Generic.List[object]]::new()

function Add-Row([string] $Kind, [string] $Name, [bool] $Ok, [string] $Detail) {
    $script:Rows.Add([pscustomobject]@{ Kind = $Kind; Name = $Name; Ok = $Ok; Detail = $Detail })
    $mark = if ($Kind -eq 'observe') { 'OBS ' } elseif ($Ok) { 'PASS' } else { 'FAIL' }
    Write-Host "[$mark] $Name :: $Detail"
}

function Format-Detail($Value) {
    return ((@($Value) | ForEach-Object { "$_" }) -join ' ; ').Trim()
}

function Test-Gate([string] $Name, [scriptblock] $Body) {
    try { Add-Row 'gate' $Name $true (Format-Detail (& $Body)) }
    catch { Add-Row 'gate' $Name $false $_.Exception.Message }
}

function Test-Observe([string] $Name, [scriptblock] $Body) {
    try { Add-Row 'observe' $Name $true (Format-Detail (& $Body)) }
    catch { Add-Row 'observe' $Name $false ("관찰 실패: " + $_.Exception.Message) }
}

# ── 도우미 ─────────────────────────────────────────────────────────────────
function Stop-Tree([int] $ProcessId) { & taskkill.exe /PID $ProcessId /T /F 2>&1 | Out-Null }

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
        Select-Object ProcessId, ParentProcessId, ExecutablePath, CommandLine, CreationDate
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

# 도는 앱이 쥔 파일도 읽는다 (FileShare.ReadWrite).
function Read-Shared([string] $Path) {
    $fs = [System.IO.File]::Open($Path, 'Open', 'Read', 'ReadWrite')
    try {
        $sr = [System.IO.StreamReader]::new($fs, [System.Text.Encoding]::UTF8)
        return $sr.ReadToEnd()
    } finally { $fs.Dispose() }
}

# 단계마다 로그 폴더를 비우고(앞 단계 것은 결과 폴더로 옮긴다) 시작한다 — 판정이 앞 단계의
# 줄을 줍지 않게. 앱 데이터는 두어 실제 사용자처럼 이어 간다.
function Get-LogText {
    if (-not (Test-Path -LiteralPath $LogDir)) { return '' }
    $parts = Get-ChildItem -LiteralPath $LogDir -Filter 'oculpm.log*' -File -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime | ForEach-Object { Read-Shared $_.FullName }
    return ($parts -join "`n")
}
function Test-LogHas([string] $Text) { return (Get-LogText).Contains($Text) }
function Get-LogLines([string] $Text) { return @((Get-LogText) -split "`r?`n" | Where-Object { $_.Contains($Text) }) }
function Get-LogLast([string] $Text) { return (Get-LogLines $Text | Select-Object -Last 1) }
function Save-Logs([string] $Label) {
    $dest = Join-Path $OutDir "logs-$Label"
    New-Item -ItemType Directory -Force -Path $dest | Out-Null
    if (Test-Path -LiteralPath $LogDir) {
        Get-ChildItem -LiteralPath $LogDir -File | Move-Item -Destination $dest -Force -ErrorAction SilentlyContinue
    }
}

function Get-SetupLogLength { if (Test-Path -LiteralPath $SetupLog) { (Get-Item -LiteralPath $SetupLog).Length } else { 0 } }
function Read-SetupLogSince([long] $Offset) {
    if (-not (Test-Path -LiteralPath $SetupLog)) { return '' }
    $bytes = [System.IO.File]::ReadAllBytes($SetupLog)
    if ($bytes.Length -le $Offset) { return '' }
    return [System.Text.Encoding]::Default.GetString($bytes, [int]$Offset, $bytes.Length - [int]$Offset)
}

function Get-Access([string] $Path) {
    if (-not (Test-Path -LiteralPath $Access)) { return @() }
    return @(Get-Content -LiteralPath $Access | Where-Object { $_ } | ForEach-Object { $_ | ConvertFrom-Json } |
        Where-Object { $_.path -eq $Path -and $_.status -eq 200 })
}
function Clear-Access { Set-Content -LiteralPath $Access -Value $null -NoNewline }

function Write-Latest([string] $Sig, [string] $Notes) {
    $out = & node $Http latest --out (Join-Path $Serve 'latest.json') --version $New --url $Url --sig $Sig --keys $Keys --notes $Notes 2>&1 | Out-String
    if ($LASTEXITCODE -ne 0) { throw "latest.json 을 못 썼다: $out" }
    return $out.Trim()
}

function Get-Installed {
    $k = Get-ItemProperty -LiteralPath $UninstKey -ErrorAction SilentlyContinue
    if (-not $k) { return $null }
    return $k
}

function Start-App {
    $p = Start-Process -FilePath $script:MainExe -WorkingDirectory $InstDir -PassThru
    $null = $p.Handle # 끝났을 때 ExitCode 를 읽으려고
    $script:App = $p
    return $p
}

function Stop-App {
    foreach ($name in @('ocul-pm.exe', 'oculpm-mcp.exe')) {
        Get-AppProcesses $name | ForEach-Object { Stop-Tree $_.ProcessId }
    }
    $null = Wait-Until -TimeoutSec 15 -Condition { -not (Get-AppProcesses 'ocul-pm.exe') }
    Start-Sleep -Seconds 1
}

function Test-Running([System.Diagnostics.Process] $Process) {
    if ($null -eq $Process) { return $false }
    $Process.Refresh()
    return -not $Process.HasExited
}

$script:MainExe = Join-Path $InstDir 'ocul-pm.exe'
$script:App = $null
$script:HttpProc = $null

try {

# ── 0. 입력 · 설치(N) · 서버 ───────────────────────────────────────────────
Test-Gate '입력 — 스모크 판(N) · 새 판(N+1) · 서명 셋 · updater-info.txt' {
    if (-not ($Base -and $New -and $Port)) { throw "updater-info.txt 가 모자라다: $(($Info.GetEnumerator() | ForEach-Object { "$($_.Key)=$($_.Value)" }) -join ' ')" }
    $missing = @($BaseSetup, $BaseSig, $Payload, $PayloadSig, $ForeignSig, $Http | Where-Object { -not (Test-Path -LiteralPath $_) })
    if ($missing.Count) {
        throw "없다: $($missing -join ', ') · 번들: $((Get-ChildItem -LiteralPath $BundleDir | ForEach-Object Name) -join ' ') · 재료: $((Get-ChildItem -LiteralPath $UpdaterDir -Recurse -File | ForEach-Object Name) -join ' ')"
    }
    if (-not ([version]$Base -lt [version]$New)) { throw "스모크 판 $Base 가 새 판 $New 보다 낮지 않다" }
    # 새 판의 .sig 는 재료와 같은 run 의 번들에 대한 것이다 — 다른 run 의 번들이 섞이면 설치
    # 시험이 「서명 불일치」 로 거짓 실패한다. 받은 번들이 그 파일인지 먼저 본다.
    $hash = (Get-FileHash -LiteralPath $Payload -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($hash -ne $Info['payload_sha256']) { throw "받은 새 판이 재료의 것이 아니다: $hash ≠ $($Info['payload_sha256'])" }
    "N=$Base → N+1=$New · 포트 $Port · 키 $Keys"
}

Test-Gate "설치 — 스모크 판 N ($Base) 무음 설치 (/S)" {
    $p = Start-Process -FilePath $BaseSetup -ArgumentList '/S' -PassThru
    $null = $p.Handle
    if (-not $p.WaitForExit(600000)) { Stop-Tree $p.Id; throw '10분 안에 끝나지 않았다' }
    if ($p.ExitCode -ne 0) { throw "종료 코드 $($p.ExitCode)" }
    $k = Get-Installed
    if (-not $k) { throw "Uninstall 키가 없다: $UninstKey" }
    if ($k.DisplayVersion -ne $Base) { throw "DisplayVersion=$($k.DisplayVersion) (기대 $Base)" }
    if ($k.MainBinaryName) { $script:MainExe = Join-Path $InstDir $k.MainBinaryName }
    if (-not $script:MainExe.EndsWith('.exe')) { $script:MainExe = "$($script:MainExe).exe" }
    if (-not (Test-Path -LiteralPath $script:MainExe)) { throw "없다: $($script:MainExe)" }
    $script:BaseExeHash = (Get-FileHash -LiteralPath $script:MainExe).Hash
    "DisplayVersion=$($k.DisplayVersion) · exe $($script:MainExe) FileVersion=$((Get-Item -LiteralPath $script:MainExe).VersionInfo.FileVersion)"
}

Test-Gate "배치 · 로컬 업데이트 서버 — 127.0.0.1:$Port" {
    Copy-Item -LiteralPath $Payload -Destination (Join-Path $Serve $PayloadName) -Force
    Clear-Access
    $script:HttpProc = Start-Process -FilePath 'node' -ArgumentList @("`"$Http`"", 'serve', '--root', "`"$Serve`"", '--port', $Port, '--log', "`"$Access`"") `
        -NoNewWindow -PassThru -RedirectStandardOutput (Join-Path $OutDir 'http.out') -RedirectStandardError (Join-Path $OutDir 'http.err')
    $ok = Wait-Until -TimeoutSec 20 -Condition {
        try { (Invoke-WebRequest -Uri $Url -Method Head -UseBasicParsing -TimeoutSec 5).StatusCode -eq 200 } catch { $false }
    }
    if (-not $ok) { throw "서버가 안 뜬다: $(Get-Content -Raw -LiteralPath (Join-Path $OutDir 'http.err') -ErrorAction SilentlyContinue)" }
    Clear-Access
    "N+1 $PayloadName ($([math]::Round((Get-Item -LiteralPath $Payload).Length / 1MB, 1)) MB) · $((Get-Content -LiteralPath (Join-Path $OutDir 'http.out') -TotalCount 1))"
}

# ── 1·2. 거절 — 서명이 틀린 latest.json ───────────────────────────────────
# 앱이 latest.json 을 묻고 → 새 판을 끝까지 받고 → 검증에서 거절해야 한다. 받기 전에 끝나면
# (주소·서버 문제) 서명을 본 것이 아니므로 「받았다」 도 gate 다.
function Invoke-NegativePhase([string] $Phase, [string] $Sig, [string] $Expect, [string] $What) {
    Clear-Access
    $setupOffset = Get-SetupLogLength
    Test-Gate "$Phase — latest.json ($What)" { Write-Latest $Sig $Phase }
    Test-Gate "$Phase — 스모크 판이 떴다 (기동 줄 판 $Base · bundle=nsis)" {
        $null = Start-App
        if (-not (Wait-Until -TimeoutSec 90 -Condition { Test-LogHas "install kind — version $Base" })) {
            throw "90초 안에 기동 줄(판 $Base)이 없다 · 앱 종료 여부: $(-not (Test-Running $script:App))"
        }
        $line = Get-LogLast 'install kind — version'
        if ($line -notlike '*bundle=nsis*') { throw "설치 형식이 nsis 가 아니다: $line" }
        $line.Trim()
    }
    Test-Gate "$Phase — 서명 검증이 거절했다 ('$Expect')" {
        if (-not (Wait-Until -TimeoutSec 180 -Condition { Test-LogHas 'install -> error' })) {
            throw "180초 안에 install -> error 가 없다 · updater 줄: $((Get-LogLines 'updater' | Select-Object -Last 5) -join ' | ') · 접근: $(Get-Content -Raw -LiteralPath $Access -ErrorAction SilentlyContinue)"
        }
        $line = Get-LogLast 'install -> error'
        if ($line -notlike "*$Expect*") { throw "거절 문장이 기대('$Expect')와 다르다: $line" }
        $line.Trim()
    }
    Test-Gate "$Phase — 새 판을 끝까지 받은 뒤 거절했다 (접근 로그)" {
        $q = @(Get-Access '/latest.json').Count
        $hits = @(Get-Access "/$PayloadName")
        $want = (Get-Item -LiteralPath $Payload).Length
        $got = if ($hits.Count) { [long]$hits[-1].bytes } else { 0 }
        $detail = "latest.json 200×$q · 새 판 200×$($hits.Count) ($got/$want B)"
        if ($q -lt 1 -or $hits.Count -lt 1 -or $got -ne $want) { throw $detail }
        $detail
    }
    Test-Gate "$Phase — 설치 파일은 안 돌았다 (DisplayVersion · exe 해시 · 설치 로그 불변)" {
        $k = Get-Installed
        $hash = (Get-FileHash -LiteralPath $script:MainExe).Hash
        $added = Read-SetupLogSince $setupOffset
        $detail = "DisplayVersion=$($k.DisplayVersion) · exe 해시 $(if ($hash -eq $script:BaseExeHash) { '그대로' } else { '바뀜' }) · 설치 로그 새 줄 $(@($added -split "`r?`n" | Where-Object { $_ }).Count)"
        if ($k.DisplayVersion -ne $Base -or $hash -ne $script:BaseExeHash -or $added) { throw "$detail · $added" }
        $detail
    }
    Test-Gate "$Phase — 앱은 N 그대로 살아 있다" {
        Start-Sleep -Seconds 3
        if (-not (Test-Running $script:App)) { throw "앱이 끝났다 (종료 코드 $($script:App.ExitCode))" }
        "pid=$($script:App.Id) alive"
    }
    Test-Observe "$Phase — 스크린샷 (배너: 업데이트 실패)" { Save-Screenshot (Join-Path $OutDir "$Phase.png") }
    Stop-App
    Save-Logs $Phase
}

Invoke-NegativePhase 'reject-content' $BaseSig 'The signature verification failed' '서명은 같은 키지만 스모크 판 파일의 것'
Invoke-NegativePhase 'reject-key' $ForeignSig 'different key than the one provided' '새 판을 다른 일회용 키로 서명한 것'

# ── 3. 설치 — 맞는 서명 ────────────────────────────────────────────────────
$Phase = 'install'
Clear-Access
$setupOffset = Get-SetupLogLength
$script:InstallerSeen = @()
Test-Gate "$Phase — latest.json (새 판의 .sig)" { Write-Latest $PayloadSig $Phase }

Test-Gate "$Phase — 스모크 판이 떴다 (기동 줄 판 $Base)" {
    $null = Start-App
    $script:OldPid = $script:App.Id
    if (-not (Wait-Until -TimeoutSec 90 -Condition { Test-LogHas "install kind — version $Base" })) { throw "90초 안에 기동 줄(판 $Base)이 없다" }
    "pid=$($script:OldPid)"
}

# 업데이터는 받은 설치 파일을 %TEMP%\Ocul-PM-<판>-updater-*\ 에 쓰고 /P /R /UPDATE /ARGS 로
# 띄운 뒤 process::exit(0) 한다. 도는 동안 그 명령줄을 붙잡아 둔다(모양은 관찰로 남긴다).
Test-Gate "$Phase — 서명 검증 통과 → NSIS 가 새 판을 깔았다 (DisplayVersion $New)" {
    $ok = Wait-Until -TimeoutSec 300 -StepMs 250 -Condition {
        foreach ($p in @(Get-CimInstance Win32_Process -Filter "Name LIKE '%installer%.exe' OR Name LIKE '%setup%.exe'" -ErrorAction SilentlyContinue)) {
            $line = "$($p.Name): $($p.CommandLine)"
            if ($script:InstallerSeen -notcontains $line) { $script:InstallerSeen += $line }
        }
        $k = Get-Installed
        $k -and $k.DisplayVersion -eq $New
    }
    $k = Get-Installed
    if (-not $ok) {
        throw "300초 안에 DisplayVersion 이 $New 가 아니다 ($($k.DisplayVersion)) · updater 줄: $((Get-LogLines 'updater' | Select-Object -Last 6) -join ' | ') · 접근: $(Get-Content -Raw -LiteralPath $Access -ErrorAction SilentlyContinue)"
    }
    "DisplayVersion=$($k.DisplayVersion)"
}

Test-Gate "$Phase — 받은 것은 새 판 전부 (접근 로그) · 앱 로그 install -> start · 오류 없음" {
    $hits = @(Get-Access "/$PayloadName")
    $want = (Get-Item -LiteralPath $Payload).Length
    $got = if ($hits.Count) { [long]$hits[-1].bytes } else { 0 }
    if ($got -ne $want) { throw "새 판을 $got/$want B 받았다" }
    # 앱 로그는 NSIS 가 다시 띄운 새 판의 줄도 섞인다 — install 줄은 옛 판(N)만 쓴다.
    if (-not (Test-LogHas 'install -> start')) { throw 'install -> start 줄이 없다' }
    if (Test-LogHas 'install -> error') { throw "오류 줄: $(Get-LogLast 'install -> error')" }
    "새 판 $got B · $((Get-LogLast 'install -> start').Trim())"
}

Test-Gate "$Phase — 설치 파일이 실제로 돌았다 (설치 로그의 [ocul-pm $New] 줄 · exe 가 새 판)" {
    $ok = Wait-Until -TimeoutSec 60 -Condition { (Read-SetupLogSince $setupOffset).Contains("[ocul-pm $New]") }
    $added = @((Read-SetupLogSince $setupOffset) -split "`r?`n" | Where-Object { $_ })
    if (-not $ok) { throw "설치 로그에 [ocul-pm $New] 줄이 없다 · 새 줄: $($added -join ' | ')" }
    $item = Get-Item -LiteralPath $script:MainExe
    $hash = (Get-FileHash -LiteralPath $script:MainExe).Hash
    if ($hash -eq $script:BaseExeHash) { throw 'exe 해시가 그대로다 — 새 판이 안 깔렸다' }
    if (-not "$($item.VersionInfo.ProductVersion)".StartsWith($New)) { throw "exe ProductVersion=$($item.VersionInfo.ProductVersion) (기대 $New)" }
    "설치 로그 새 줄 $($added.Count): $(($added | Select-Object -First 4) -join ' | ') · exe ProductVersion=$($item.VersionInfo.ProductVersion) · LastWriteTime=$($item.LastWriteTime.ToString('s'))"
}

Test-Gate "$Phase — 옛 프로세스는 끝났고 NSIS 가 새 판을 다시 띄웠다 (기동 줄 판 $New)" {
    if (Test-Running (Get-Process -Id $script:OldPid -ErrorAction SilentlyContinue)) { throw "옛 프로세스(pid $($script:OldPid))가 아직 산다" }
    if (-not (Wait-Until -TimeoutSec 120 -Condition { Test-LogHas "install kind — version $New" })) {
        throw "120초 안에 새 판($New) 기동 줄이 없다 · 기동 줄: $((Get-LogLines 'install kind') -join ' | ') · 프로세스: $((Get-AppProcesses (Split-Path -Leaf $script:MainExe) | ForEach-Object { $_.ProcessId }) -join ',')"
    }
    $procs = @(Get-AppProcesses (Split-Path -Leaf $script:MainExe) | Where-Object { $_.ProcessId -ne $script:OldPid })
    if (-not $procs.Count) { throw '기동 줄은 있는데 새 프로세스가 없다' }
    "새 pid $(($procs | ForEach-Object ProcessId) -join ',') · 기동 줄의 판: $((Get-LogLines 'install kind — version' | ForEach-Object { if ($_ -match 'install kind — version (\S+)') { $Matches[1] } }) -join ' ')"
}

Test-Observe "$Phase — 업데이터가 띄운 설치 파일 명령줄 (/P /R /UPDATE /ARGS 모양)" {
    if (-not $script:InstallerSeen.Count) { throw '250ms 간격으로는 못 봤다 (설치가 그보다 빨랐다)' }
    $script:InstallerSeen
}
# 새 판은 릴리스 설정(엔드포인트 GitHub · 진짜 공개 키)이다 — 떠서 한 번 묻는다. 결과는 그날의
# GitHub latest.json 에 달렸으므로 기록만(이 OS 가 아직 없으면 noBuild).
Test-Observe "$Phase — 새 판의 첫 확인 (진짜 GitHub latest.json 에 대해)" {
    $null = Wait-Until -TimeoutSec 60 -Condition { (Get-LogLines 'check -> ').Count -ge 2 }
    (Get-LogLast 'check -> ').Trim()
}
Test-Observe "$Phase — 스크린샷 (새 판)" { Save-Screenshot (Join-Path $OutDir "$Phase.png") }
Stop-App
Save-Logs $Phase

} catch {
    Add-Row 'gate' '스크립트 자체 오류 (여기서 멈춤)' $false ("$($_.Exception.Message) @ $($_.InvocationInfo.PositionMessage)")
} finally {
    Stop-App
    if ($script:HttpProc) { Stop-Tree $script:HttpProc.Id }
    if (Test-Path -LiteralPath $SetupLog) { Copy-Item -LiteralPath $SetupLog -Destination (Join-Path $OutDir 'ocul-pm-setup.log') -Force }
}

# ── 요약 ───────────────────────────────────────────────────────────────────
$gates = @($script:Rows | Where-Object Kind -eq 'gate')
$failed = @($gates | Where-Object { -not $_.Ok })
$md = [System.Text.StringBuilder]::new()
[void]$md.AppendLine("## 업데이터 스모크 — windows (Ocul-PM $Base → $New)")
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
    Write-Host "::error::업데이터 스모크(windows) gate 실패 $($failed.Count)건: $(($failed | ForEach-Object Name) -join ' / ')"
    exit 1
}
Write-Host "업데이터 스모크(windows) 통과 — gate $($gates.Count)건"
exit 0
