#Requires -Version 7.0
<#
.SYNOPSIS
  설치 스모크(Windows)의 OS 하한 · C 런타임 검사 — install-smoke-windows.ps1 이 dot-source 한다.

.DESCRIPTION
  OS 하한     — src-tauri/windows/installer-hooks.nsh 가 PREINSTALL 에서 하는 판정. 빌드 번호를
                OCULPM_TEST_OS_BUILD 로 주입해 19040 이면 막고(종료 코드 ≠ 0, 아무것도 안 깔림,
                로그에 STOP) 19041 이면 통과하는지.
  C 런타임    — 두 exe 가 VCRUNTIME140 · MSVCP140 을 가져오지 않는지(dumpbin /dependents). 설치 파일은
                VC++ 재배포를 싣지 않는다(2026-11-11) — tauri-build 가 VC 런타임을 정적으로 링크하고
                (static_vcruntime: libcmt + libvcruntime, UCRT 는 Windows 10 부터 OS 내장), MSVCP140 을
                부르던 사전 빌드 ONNX Runtime 은 4.0 에서 걷혔다. 예전 install-smoke-windows-vcrt.ps1 이
                재배포 설치 경로를 쟀다.

  기록은 %TEMP%\ocul-pm-setup.log (훅이 쓴다) — Invoke-Setup 이 설치마다 새로 붙은 줄을
  $script:LastSetupLog 에 남긴다.
#>

$HooksText = Get-Content -LiteralPath (Join-Path $PSScriptRoot '..\..\src-tauri\windows\installer-hooks.nsh') -Raw
$MinOsBuild = [int]([regex]::Match($HooksText, '(?m)^!define OCULPM_MIN_OS_BUILD (\d+)').Groups[1].Value)

function Get-LogLines([string] $Text, [string] $Pattern) {
    @(($Text -split "`r?`n") | Where-Object { $_ -match $Pattern } | ForEach-Object { $_.Trim() })
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

# ── OS 하한 — 첫 설치 뒤 (주입값 = 하한 그대로) ──────────────────────────
function Test-OsFloorPassed {
    Test-Gate "OS 하한 — 빌드 $MinOsBuild 이면 통과 (주입값으로 설치 · 로그)" {
        $os = @(Get-LogLines $script:FirstInstallLog "os: build $MinOsBuild \(from OCULPM_TEST_OS_BUILD\)")
        $stop = @(Get-LogLines $script:FirstInstallLog 'STOP:')
        if (-not $os.Count -or $stop.Count) { throw "로그: $((Get-LogLines $script:FirstInstallLog '^\[ocul-pm') -join ' | ')" }
        $os[0]
    }
}

# ── C 런타임 — 재배포 없이 뜨는가의 전제 ─────────────────────────────────
# 재배포를 싣지 않으므로 이것이 붉으면 VC++ 재배포가 없는 PC 에서 앱이 안 뜬다. 원인은 둘 중 하나:
# tauri-build 의 정적 VC 런타임(build > windows > staticVCRuntime)이 꺼졌거나, C++ 런타임(MSVCP140)을
# 부르는 사전 빌드 의존이 들어왔다.
function Test-NoVcRuntimeImports {
    Test-Gate 'C 런타임 정적 — 두 exe 가 VCRUNTIME140 · MSVCP140 을 가져오지 않는다 (dumpbin /dependents)' {
        $dumpbin = Find-Dumpbin
        $bad = @()
        $rows = foreach ($exe in @($script:MainExe, $script:Mcp)) {
            $deps = & $dumpbin /nologo /dependents $exe 2>&1 | Out-String
            Set-Content -LiteralPath (Join-Path $OutDir ("{0}.dependents.txt" -f (Split-Path -Leaf $exe))) -Value $deps
            $names = @([regex]::Matches($deps, '(?im)^\s+(\S+\.dll)\s*$') | ForEach-Object { $_.Groups[1].Value })
            $vc = @($names | Where-Object { $_ -match '^(vcruntime|msvcp)\d+' })
            if ($vc.Count) { $bad += '{0}: {1}' -f (Split-Path -Leaf $exe), ($vc -join '+') }
            '{0}: DLL {1}개 ({2})' -f (Split-Path -Leaf $exe), $names.Count, ($names -join ' ')
        }
        if ($bad.Count) { throw "VC++ 런타임 DLL 을 가져온다 — $($bad -join ' · ') · 설치 파일은 재배포를 싣지 않는다" }
        $rows -join ' · '
    }
}
