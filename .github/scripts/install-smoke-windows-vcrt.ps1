#Requires -Version 7.0
<#
.SYNOPSIS
  설치 스모크(Windows)의 OS 하한 · VC++ 런타임 검사 — install-smoke-windows.ps1 이 dot-source 한다.

.DESCRIPTION
  src-tauri/windows/installer-hooks.nsh 가 PREINSTALL 에서 하는 두 판정을 러너에서 실측한다.

    OS 하한     — 빌드 번호를 OCULPM_TEST_OS_BUILD 로 주입해 19040 이면 막고(종료 코드 ≠ 0,
                  아무것도 안 깔림, 로그에 STOP) 19041 이면 통과하는지.
    VC++ 런타임 — (b) 이미 있으면 vc_redist 를 건너뛰는지(로그 "skipping"),
                  (a) 없는 PC 에서(System32 의 VC++ DLL 네 개를 숨기고 레지스트리 Installed=0)
                      설치하면 vc_redist 가 깔리고 앱이 뜨는지 — PATH 도 System32·Windows 로 좁혀
                      러너의 도구 폴더에 있는 사본을 못 줍게 한다,
                  그리고 설치가 실패하면(UAC 취소를 OCULPM_TEST_VCREDIST_EXIT=1602 로 흉내)
                      "설치 완료" 가 아니라 멈추는지(종료 코드 ≠ 0, 로그에 STOP).
    도구 판      — exe 안 어떤 코드도 링크한 MSVC 보다 새 MSVC 로 컴파일되지 않았는지(PE Rich
                  헤더). 요구 판(= 동봉 재배포, 링크 도구와 같은 계열)의 전제다 — Microsoft 규칙:
                  재배포는 앱 구성 요소가 쓴 가장 새 도구 이상.

  기록은 %TEMP%\ocul-pm-setup.log (훅이 쓴다) — Invoke-Setup 이 설치마다 새로 붙은 줄을
  $script:LastSetupLog 에 남긴다.
#>

$VcDlls = @('msvcp140.dll', 'msvcp140_1.dll', 'vcruntime140.dll', 'vcruntime140_1.dll')
$VcRuntimeKey = 'HKLM:\SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64'
$CleanPath = "$env:windir\System32;$env:windir;$env:windir\System32\WindowsPowerShell\v1.0"
$script:HiddenVc = @()
$script:VcInstalledBefore = $null

$HooksText = Get-Content -LiteralPath (Join-Path $PSScriptRoot '..\..\src-tauri\windows\installer-hooks.nsh') -Raw
$VcrtMinBld = [int]([regex]::Match($HooksText, '(?m)^!define OCULPM_VCRT_MIN_BLD (\d+)').Groups[1].Value)
$MinOsBuild = [int]([regex]::Match($HooksText, '(?m)^!define OCULPM_MIN_OS_BUILD (\d+)').Groups[1].Value)

# System32 의 msvcp140.dll 판과 레지스트리 키 — 훅의 OCULPM_VCRT_STATE 와 같은 두 근거.
function Get-VcrtState {
    $sys = Join-Path $env:windir 'System32'
    $missing = @($VcDlls | Where-Object { -not (Test-Path -LiteralPath (Join-Path $sys $_)) })
    $fileBld = if (Test-Path -LiteralPath (Join-Path $sys 'msvcp140.dll')) {
        (Get-Item -LiteralPath (Join-Path $sys 'msvcp140.dll')).VersionInfo.FileBuildPart
    } else { $null }
    $reg = Get-ItemProperty -LiteralPath $VcRuntimeKey -ErrorAction SilentlyContinue
    [pscustomobject]@{
        Missing   = $missing
        FileBld   = $fileBld
        RegInst   = if ($reg) { $reg.Installed } else { $null }
        RegBld    = if ($reg) { $reg.Bld } else { $null }
        RegVer    = if ($reg) { $reg.Version } else { $null }
        Ok        = ($missing.Count -eq 0) -and ($fileBld -ge $VcrtMinBld) -and $reg -and ($reg.Installed -eq 1) -and ($reg.Bld -ge $VcrtMinBld)
    }
}

function Format-VcrtState($s) {
    "System32 msvcp140 빌드=$($s.FileBld) 없는 DLL=[$($s.Missing -join ',')] · 레지스트리 Installed=$($s.RegInst) Bld=$($s.RegBld) Version=$($s.RegVer) · 요구 ≥ $VcrtMinBld → " + $(if ($s.Ok) { '충족' } else { '부족' })
}

function Hide-VcRuntime {
    foreach ($d in $VcDlls) {
        $p = Join-Path $env:windir "System32\$d"
        if (-not (Test-Path -LiteralPath $p)) { continue }
        & takeown.exe /F $p /A 2>&1 | Out-Null
        & icacls.exe $p /grant '*S-1-5-32-544:F' 2>&1 | Out-Null
        $hidden = "$p.oculpm-hidden"
        if (Test-Path -LiteralPath $hidden) { Remove-Item -LiteralPath $hidden -Force }
        Rename-Item -LiteralPath $p -NewName (Split-Path -Leaf $hidden)
        $script:HiddenVc += $p
    }
    $reg = Get-ItemProperty -LiteralPath $VcRuntimeKey -ErrorAction SilentlyContinue
    if ($reg) {
        $script:VcInstalledBefore = $reg.Installed
        Set-ItemProperty -LiteralPath $VcRuntimeKey -Name Installed -Value 0 -Type DWord
    }
}

# 설치 파일이 되살려 놓았으면 그대로 둔다 — 숨긴 사본만 원래 이름이 비어 있을 때 되돌린다.
function Restore-VcRuntime {
    foreach ($p in $script:HiddenVc) {
        $h = "$p.oculpm-hidden"
        if ((Test-Path -LiteralPath $h) -and -not (Test-Path -LiteralPath $p)) { Rename-Item -LiteralPath $h -NewName (Split-Path -Leaf $p) }
    }
    $script:HiddenVc = @()
    if ($null -ne $script:VcInstalledBefore) {
        $reg = Get-ItemProperty -LiteralPath $VcRuntimeKey -ErrorAction SilentlyContinue
        if ($reg -and $reg.Installed -ne 1) { Set-ItemProperty -LiteralPath $VcRuntimeKey -Name Installed -Value $script:VcInstalledBefore -Type DWord }
        $script:VcInstalledBefore = $null
    }
}

# 좁힌 PATH 로 띄워 끝나기를 기다린다(시한 30초). 출력·종료 코드를 돌려준다.
function Invoke-CleanEnv([string] $Exe, [string[]] $Arguments) {
    $psi = [System.Diagnostics.ProcessStartInfo]::new($Exe)
    foreach ($a in $Arguments) { $psi.ArgumentList.Add($a) }
    $psi.UseShellExecute = $false
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.CreateNoWindow = $true
    $psi.WorkingDirectory = $ProbeRoot
    $psi.Environment['PATH'] = $CleanPath
    $p = [System.Diagnostics.Process]::Start($psi)
    if (-not $p.WaitForExit(30000)) { Stop-Tree $p.Id; return [pscustomobject]@{ Exit = $null; Text = '시한 초과(30초)' } }
    $out = ($p.StandardOutput.ReadToEnd() + $p.StandardError.ReadToEnd()).Trim()
    if ($out.Length -gt 120) { $out = $out.Substring(0, 120) + '…' }
    return [pscustomobject]@{ Exit = $p.ExitCode; Text = ('exit={0} (0x{1:X8}) {2}' -f $p.ExitCode, $p.ExitCode, ($out -replace "`r?`n", ' ')) }
}

function Get-LogLines([string] $Text, [string] $Pattern) {
    @(($Text -split "`r?`n") | Where-Object { $_ -match $Pattern } | ForEach-Object { $_.Trim() })
}

# PE Rich 헤더 — link.exe 가 링크된 목적 파일마다 (도구 prodid, 빌드, 개수)를 XOR 로 적어 둔다.
# 첫 실측(windows-latest 2026-09): 링커 36257 · C 36257(cc-rs) · C++/C/MASM 35721(러너 MSVC 의
# 정적 런타임 조각) · ONNX Runtime 35222. 그래서 "C++ = ONNX Runtime 뿐" 이 아니다.
function Get-RichEntries([string] $Path) {
    $b = [System.IO.File]::ReadAllBytes($Path)
    $pe = [BitConverter]::ToInt32($b, 0x3C)
    $rich = $null
    for ($i = 0x40; $i -lt $pe - 8; $i += 4) {
        if ($b[$i] -eq 0x52 -and $b[$i + 1] -eq 0x69 -and $b[$i + 2] -eq 0x63 -and $b[$i + 3] -eq 0x68) { $rich = $i; break }
    }
    if ($null -eq $rich) { throw 'Rich 헤더가 없다' }
    $key = [uint64][BitConverter]::ToUInt32($b, $rich + 4)
    $start = $null
    for ($j = $rich - 4; $j -ge 0x40; $j -= 4) {
        if ((([uint64][BitConverter]::ToUInt32($b, $j)) -bxor $key) -eq 0x536E6144) { $start = $j; break }
    }
    if ($null -eq $start) { throw 'Rich 헤더의 DanS 표지를 못 찾았다' }
    for ($k = $start + 16; $k -lt $rich; $k += 8) {
        $comp = ([uint64][BitConverter]::ToUInt32($b, $k)) -bxor $key
        $count = ([uint64][BitConverter]::ToUInt32($b, $k + 4)) -bxor $key
        [pscustomobject]@{ ProdId = [int]($comp -shr 16); Build = [int]($comp -band 0xFFFF); Count = [int]$count }
    }
}

# ── OS 하한 — 첫 설치 전 ─────────────────────────────────────────────────
function Invoke-OsFloorProbes {
    Test-Gate "OS 하한 — 빌드 $($MinOsBuild - 1) 이면 설치를 막는다 (종료 코드 ≠ 0 · 아무것도 안 깔림 · 로그 STOP)" {
        $env:OCULPM_TEST_OS_BUILD = [string]($MinOsBuild - 1)
        try { $r = Invoke-Setup $Installer @('/S') -TimeoutSec 120 } finally { Remove-Item Env:OCULPM_TEST_OS_BUILD -ErrorAction SilentlyContinue }
        $stop = @(Get-LogLines $script:LastSetupLog 'STOP: Ocul-PM requires Windows 10 version 2004')
        $installed = (Test-Path -LiteralPath $script:MainExe) -or (Test-Path -LiteralPath $UninstKey)
        $detail = "종료 코드 $($r.ExitCode) · 설치 흔적 " + $(if ($installed) { '있음' } else { '없음' }) + " · 로그: $((Get-LogLines $script:LastSetupLog '^\[ocul-pm') -join ' | ')"
        if ($r.TimedOut -or $r.ExitCode -eq 0 -or $installed -or -not $stop.Count) { throw $detail }
        $detail
    }

    # 사용자가 보는 문구 — passive(/P)는 무음이 아니라 대화상자가 뜬다. 화면을 찍고 끝낸다.
    Test-Observe "OS 하한 — 막을 때 사용자가 보는 대화상자 (passive, 러너 언어=영어)" {
        $env:OCULPM_TEST_OS_BUILD = [string]($MinOsBuild - 1)
        $shot = Join-Path $OutDir 'os-too-old-dialog.png'
        try { $r = Invoke-Setup $Installer @('/P') -TimeoutSec 25 -ShotOnTimeout $shot } finally { Remove-Item Env:OCULPM_TEST_OS_BUILD -ErrorAction SilentlyContinue }
        if ($r.TimedOut) { "대화상자에서 멈춤 — 화면: $(Split-Path -Leaf $shot)" } else { "대화상자 없이 끝남(종료 코드 $($r.ExitCode))" }
    }
}

# ── VC++ 런타임 — 첫 설치 뒤 ─────────────────────────────────────────────
function Test-VcrtAfterFirstInstall {
    Test-Gate "OS 하한 — 빌드 $MinOsBuild 이면 통과 (주입값으로 설치 · 로그)" {
        $os = @(Get-LogLines $script:FirstInstallLog "os: build $MinOsBuild \(from OCULPM_TEST_OS_BUILD\)")
        $stop = @(Get-LogLines $script:FirstInstallLog 'STOP:')
        if (-not $os.Count -or $stop.Count) { throw "로그: $((Get-LogLines $script:FirstInstallLog '^\[ocul-pm') -join ' | ')" }
        $os[0]
    }
    Test-Gate "VC++ 런타임 — 첫 설치 뒤 요구 빌드 $VcrtMinBld 이상 · 로그에 판정" {
        $decision = @(Get-LogLines $script:FirstInstallLog '^\[ocul-pm .*\] vcredist:')
        $s = Get-VcrtState
        if (-not $decision.Count -or -not $s.Ok) { throw "판정 로그: $($decision -join ' | ') · 지금: $(Format-VcrtState $s)" }
        "설치 전: $script:VcrtBefore · 판정 로그: $($decision -join ' | ') · 지금: $(Format-VcrtState $s)"
    }
}

# 재설치 로그에서 (b) — 있으면 건너뛴다.
function Test-VcrtSkippedOnReinstall {
    Test-Gate '(b) VC++ 런타임이 이미 있으면 vc_redist 를 건너뛴다 (재설치 로그)' {
        $skip = @(Get-LogLines $script:ReinstallLog 'vcredist: present .* skipping')
        $ran = @(Get-LogLines $script:ReinstallLog 'vcredist: (needed|/install)')
        if (-not $skip.Count -or $ran.Count) { throw "재설치 로그: $((Get-LogLines $script:ReinstallLog '^\[ocul-pm') -join ' | ')" }
        $skip[0]
    }
}

# exe 안 어떤 코드도 링크한 MSVC 보다 새 MSVC 로 컴파일되지 않았는가 — Rich 헤더.
# 재배포 요구 판은 "링크 도구 계열 = 동봉 재배포 계열" 로 정했다(fetch-vcredist.ps1 이 빌드 전에
# 단언). 그 전제가 깨지는 길은 하나 — 사전 빌드 ONNX Runtime 이 러너보다 새 MSVC 로 구워지는 것.
# prodid: 0x0102 링커 · 0x0103 MASM · 0x0104 C · 0x0105 C++ (ONNX Runtime lib 로 확인: C++ 909 · C 15 · MASM 37).
function Test-VcrtMinCoversToolset {
    Test-Gate '링크 도구가 exe 안 모든 코드의 MSVC 보다 새것이다 (Rich 헤더 — 사전 빌드 ONNX Runtime 포함)' {
        $rows = @(Get-RichEntries $script:MainExe)
        $linker = @($rows | Where-Object ProdId -eq 0x0102)
        if (-not $linker.Count) { throw 'Rich 헤더에 링커(0x0102) 항목이 없다' }
        $linkBld = ($linker | Measure-Object -Property Build -Maximum).Maximum
        $compiled = @($rows | Where-Object { $_.ProdId -in 0x0103, 0x0104, 0x0105 })
        $newer = @($compiled | Where-Object Build -gt $linkBld)
        $byTool = ($compiled | Group-Object ProdId | ForEach-Object {
                '0x{0:x4}: {1}' -f [int]$_.Name, (($_.Group | Sort-Object Build -Descending | ForEach-Object { "$($_.Build)×$($_.Count)" }) -join ' ')
            }) -join ' · '
        if ($newer.Count) { throw "링커 $linkBld 보다 새 도구로 컴파일된 목적 파일: $(($newer | ForEach-Object { '0x{0:x4}/{1}×{2}' -f $_.ProdId, $_.Build, $_.Count }) -join ' ') · $byTool" }
        "링커 빌드 $linkBld · 동봉 재배포 요구 ≥ $VcrtMinBld · 컴파일러별 빌드: $byTool"
    }
}

# ── (a) VC++ 재배포 없는 PC — 설치가 되살리고 앱이 뜨는가 ─────────────────
function Invoke-NoRedistProbes {
    Add-Type -Namespace OculPm -Name Native -MemberDefinition '[DllImport("kernel32.dll")] public static extern uint SetErrorMode(uint mode);' -ErrorAction SilentlyContinue
    [void][OculPm.Native]::SetErrorMode(0x0001 -bor 0x0002 -bor 0x8000)
    Get-AppProcesses (Split-Path -Leaf $script:MainExe) | ForEach-Object { Stop-Tree $_.ProcessId }
    try {
        Test-Observe 'VC++ 재배포 없는 PC 만들기 — System32 DLL 네 개 숨김 + 레지스트리 Installed=0 → 설치본이 안 뜨는지' {
            Hide-VcRuntime
            $mcp = Invoke-CleanEnv $script:Mcp @('--version')
            $main = Invoke-CleanEnv $script:MainExe @('config', '--help')
            "$(Format-VcrtState (Get-VcrtState)) · 사이드카 [$($mcp.Text)] · 메인 [$($main.Text)]"
        }

        Test-Gate '재배포 설치 실패(UAC 취소 흉내 1602) → "설치 완료" 가 아니라 멈춘다 (종료 코드 ≠ 0 · 로그 STOP)' {
            $env:OCULPM_TEST_VCREDIST_EXIT = '1602'
            try { $r = Invoke-Setup $Installer @('/S') -TimeoutSec 180 } finally { Remove-Item Env:OCULPM_TEST_VCREDIST_EXIT -ErrorAction SilentlyContinue }
            $stop = @(Get-LogLines $script:LastSetupLog 'STOP: Ocul-PM needs the Microsoft Visual C\+\+ Redistributable.*cancelled')
            $detail = "종료 코드 $($r.ExitCode) · 로그: $((Get-LogLines $script:LastSetupLog '^\[ocul-pm') -join ' | ')"
            if ($r.TimedOut -or $r.ExitCode -eq 0 -or -not $stop.Count) { throw $detail }
            $detail
        }

        Test-Observe '재배포 설치 실패 때 사용자가 보는 대화상자 (passive, 1602 흉내)' {
            $env:OCULPM_TEST_VCREDIST_EXIT = '1602'
            $shot = Join-Path $OutDir 'vcredist-failed-dialog.png'
            try { $r = Invoke-Setup $Installer @('/P') -TimeoutSec 60 -ShotOnTimeout $shot } finally { Remove-Item Env:OCULPM_TEST_VCREDIST_EXIT -ErrorAction SilentlyContinue }
            if ($r.TimedOut) { "대화상자에서 멈춤 — 화면: $(Split-Path -Leaf $shot)" } else { "대화상자 없이 끝남(종료 코드 $($r.ExitCode))" }
        }

        Test-Gate '(a) VC++ 재배포 없는 PC 에서 설치 → vc_redist 가 깔리고 런타임이 요구 빌드 이상' {
            $r = Invoke-Setup $Installer @('/S') -TimeoutSec 600
            $s = Get-VcrtState
            $log = (Get-LogLines $script:LastSetupLog '^\[ocul-pm .*\] vcredist:') -join ' | '
            $detail = "종료 코드 $($r.ExitCode) · 지금: $(Format-VcrtState $s) · 로그: $log"
            if ($r.TimedOut -or $r.ExitCode -ne 0 -or -not $s.Ok) { throw $detail }
            $detail
        }

        Test-Gate '(a) 그 PC 에서 앱이 뜬다 — 좁힌 PATH 로 사이드카 · 메인 exe · GUI(App window mounted)' {
            $mcp = Invoke-CleanEnv $script:Mcp @('--version')
            $main = Invoke-CleanEnv $script:MainExe @('config', '--help')
            if ($mcp.Exit -ne 0 -or $main.Exit -ne 0) { throw "사이드카 [$($mcp.Text)] · 메인 [$($main.Text)]" }
            $log = Get-AppLog
            $before = if ($log) { @(Select-String -LiteralPath $log.FullName -SimpleMatch 'App window mounted').Count } else { 0 }
            $psi = [System.Diagnostics.ProcessStartInfo]::new($script:MainExe)
            $psi.UseShellExecute = $false
            $psi.WorkingDirectory = $InstDir
            $psi.Environment['PATH'] = $CleanPath
            $gui = [System.Diagnostics.Process]::Start($psi)
            try {
                $mounted = Wait-Until -TimeoutSec 60 -Condition {
                    $l = Get-AppLog
                    $null -ne $l -and @(Select-String -LiteralPath $l.FullName -SimpleMatch 'App window mounted').Count -gt $before
                }
                if (-not $mounted) { throw "60초 안에 App window mounted 가 없다 (프로세스 " + $(if (Test-Running $gui) { '살아 있음' } else { "끝남 exit=$($gui.ExitCode)" }) + ')' }
                try { $null = Save-Screenshot (Join-Path $OutDir 'windows-app-after-vcredist.png') } catch { }
            } finally {
                if (Test-Running $gui) { Stop-Tree $gui.Id }
            }
            "사이드카 [$($mcp.Text)] · 메인 [$($main.Text)] · GUI 뜸"
        }
    } finally {
        Start-Sleep -Seconds 1
        Restore-VcRuntime
    }
}
